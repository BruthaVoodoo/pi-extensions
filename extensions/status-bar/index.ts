/**
 * Status Bar Extension
 *
 * Powerline-style status bar rendered inside the editor chrome.
 * Segments: model · path · git · context bar · cost · tokens · time · and more.
 *
 * Commands:
 *   /statusbar              — toggle on/off
 *   /statusbar <preset>     — switch preset (default|minimal|compact|focus|full|nerd|ascii)
 *   /statusbar info         — print current config
 *   /profile                — open profile selector
 *   /profile add            — add a new model profile
 *   /profile remove <N>     — remove profile by number
 *   /profile <N>            — switch to profile by number
 *   /stash                  — open prompt history picker
 *
 * Shortcuts:
 *   alt+s                   — stash / restore editor text
 *   ctrl+alt+h              — open stash history (configurable via statusBarShortcuts)
 *   ctrl+alt+c              — copy editor text
 *   ctrl+alt+x              — cut editor text
 *   alt+shift+tab           — cycle model profiles
 *   ctrl+alt+m              — open profile selector
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  copyToClipboard,
  CustomEditor,
} from "@mariozechner/pi-coding-agent";
import { SelectList, truncateToWidth, visibleWidth, Input, fuzzyFilter } from "@mariozechner/pi-tui";
import type { SelectItem } from "@mariozechner/pi-tui";

import type { ColorScheme, SegmentContext, StatusLinePreset } from "./types.js";
import { getPreset, PRESETS } from "./presets.js";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { getDefaultColors } from "./theme.js";
import { ansi, getFgAnsiCode } from "./colors.js";
import { computeLayout, type LayoutResult } from "./layout.js";
import { WelcomeOverlay, discoverLoadedCounts, getRecentSessions } from "./welcome.js";
import {
  readSettings, writeSettings, savePreset, normalizePreset, isValidPreset,
  readStashHistory, writeStashHistory, readProjectPrompts, resolveShortcuts,
  type StatusBarShortcuts,
} from "./config.js";
import {
  reloadProfiles, saveProfiles, getProfilesCache,
  getActiveProfileIndex, setActiveProfileIndex,
  findMatchingProfileIndex, getProfileDisplayName,
  parseModelSpec, isThinkingLevel,
  type ProfileConfig,
} from "./profiles.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const STASH_PREVIEW_WIDTH = 72;
const STASH_LIMIT = 12;
const PROJECT_PROMPT_LIMIT = 50;

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function statusBar(pi: ExtensionAPI) {
  const startupSettings  = readSettings();
  const shortcuts: StatusBarShortcuts = resolveShortcuts(startupSettings);

  // ── State ─────────────────────────────────────────────────
  let enabled          = true;
  let currentPreset: StatusLinePreset =
    normalizePreset(startupSettings.statusBar) ?? "default";
  let sessionStartTime = Date.now();
  let currentCtx: any  = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let isStreaming       = false;
  let tuiRef: any       = null;
  let lastUserPrompt    = "";
  let showLastPrompt    = startupSettings.showLastPrompt !== false;

  // Layout cache
  let layoutCache: LayoutResult | null = null;
  let layoutWidth = 0;
  let layoutTs    = 0;

  // Welcome
  let dismissWelcome: (() => void) | null = null;
  let welcomeHeaderActive = false;
  let shouldDismissEarly  = false;

  // Stash
  let stashedText: string | null = null;
  let stashHistory: string[] = readStashHistory();

  // Profile switching guard
  let profileSwitchLock = false;

  // Clock ticker (auto-refresh time segment)
  let clockInterval: ReturnType<typeof setInterval> | null = null;

  // Editor ref (for prompt history tracking)
  let currentEditor: any = null;
  const HISTORY_TRACKED = Symbol.for("statusBarHistoryTracked");
  const HISTORY_STATE   = Symbol.for("statusBarHistoryState");

  function getHistoryState(): { saved: string[] } {
    const g = globalThis as any;
    if (!g[HISTORY_STATE]) g[HISTORY_STATE] = { saved: [] };
    return g[HISTORY_STATE];
  }

  // ── Git branch change detection ───────────────────────────
  const branchPattern = /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree|stash\s+(pop|apply))/;

  function mightChangeBranch(cmd: string): boolean {
    return branchPattern.test(cmd);
  }

  // ── Prompt history helpers ────────────────────────────────
  function readEditorHistory(editor: any): string[] {
    if (!Array.isArray(editor?.history)) return [];
    const out: string[] = [];
    for (const e of editor.history) {
      if (typeof e !== "string" || !e.trim()) continue;
      if (out.length && out[out.length - 1] === e.trim()) continue;
      out.push(e.trim());
      if (out.length >= 100) break;
    }
    return out;
  }

  function snapshotHistory(editor: any): void {
    const h = readEditorHistory(editor);
    if (h.length) getHistoryState().saved = [...h];
  }

  function restoreHistory(editor: any): void {
    const { saved } = getHistoryState();
    if (!saved.length || typeof editor?.addToHistory !== "function") return;
    for (let i = saved.length - 1; i >= 0; i--) editor.addToHistory(saved[i]);
  }

  function trackHistory(editor: any): void {
    if (!editor || typeof editor.addToHistory !== "function") return;
    if (editor[HISTORY_TRACKED]) { snapshotHistory(editor); return; }
    const orig = editor.addToHistory.bind(editor);
    editor.addToHistory = (t: string) => { orig(t); snapshotHistory(editor); };
    editor[HISTORY_TRACKED] = true;
    snapshotHistory(editor);
  }

  // ── Stash helpers ─────────────────────────────────────────
  function hasText(t: string): boolean { return t.trim().length > 0; }
  function pushStash(text: string): boolean {
    if (!hasText(text)) return false;
    if (stashHistory[0] === text) return false;
    stashHistory.unshift(text);
    if (stashHistory.length > STASH_LIMIT) stashHistory.length = STASH_LIMIT;
    writeStashHistory(stashHistory);
    return true;
  }

  function getEditorText(ctx: any): string {
    return currentEditor?.getExpandedText?.() ?? ctx.ui.getEditorText();
  }

  // ── Layout cache ──────────────────────────────────────────
  function getCachedLayout(width: number, theme: Theme): LayoutResult {
    const now = Date.now();
    if (layoutCache && layoutWidth === width && now - layoutTs < 50) return layoutCache;
    const ctx = buildSegmentContext(currentCtx, theme);
    layoutCache = computeLayout(ctx, currentPreset, width);
    layoutWidth = width;
    layoutTs = now;
    return layoutCache;
  }

  function invalidateLayout(): void { layoutCache = null; }

  // ── Segment context builder ───────────────────────────────
  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    const preset = getPreset(currentPreset);
    const colors: ColorScheme = preset.colors ?? getDefaultColors();

    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
    let lastAssistant: AssistantMessage | undefined;
    let thinkingFromSession: string | null = null;

    const branch = ctx?.sessionManager?.getBranch?.() ?? [];
    for (const e of branch) {
      if (e.type === "thinking_level_change" && e.thinkingLevel) {
        thinkingFromSession = e.thinkingLevel;
      }
      if (e.type === "message" && e.message.role === "assistant") {
        const m = e.message as AssistantMessage;
        if (m.stopReason === "error" || m.stopReason === "aborted") continue;
        input     += m.usage.input;
        output    += m.usage.output;
        cacheRead += m.usage.cacheRead;
        cacheWrite+= m.usage.cacheWrite;
        cost      += m.usage.cost.total;
        lastAssistant = m;
      }
    }

    const ctxTokens = lastAssistant
      ? lastAssistant.usage.input + lastAssistant.usage.output +
        lastAssistant.usage.cacheRead + lastAssistant.usage.cacheWrite
      : 0;
    const ctxWindow  = ctx?.model?.contextWindow ?? 0;
    const ctxPercent = ctxWindow > 0 ? (ctxTokens / ctxWindow) * 100 : 0;

    const gitBranch  = footerDataRef?.getGitBranch() ?? null;
    const git        = getGitStatus(gitBranch);
    const usingOAuth = ctx?.model ? ctx?.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false : false;

    const thinkingLevel = thinkingFromSession ?? getThinkingLevelFn?.() ?? "off";
    const profiles = getProfilesCache();
    const profileIdx = ctx?.model?.provider && ctx?.model?.id
      ? findMatchingProfileIndex(profiles, ctx.model.provider, ctx.model.id, thinkingLevel)
      : null;
    const profileLabel = profileIdx !== null ? profiles[profileIdx]?.label ?? null : null;

    const sessionName: string | null = ctx?.sessionManager?.getSessionName?.() ?? null;

    return {
      model: ctx?.model,
      thinkingLevel,
      activeProfileIndex: profileIdx,
      activeProfileLabel: profileLabel,
      sessionId: ctx?.sessionManager?.getSessionId?.(),
      sessionName,
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent: ctxPercent,
      contextWindow: ctxWindow,
      autoCompactEnabled: ctx?.settingsManager?.getCompactionSettings?.()?.enabled ?? true,
      usingSubscription: usingOAuth,
      sessionStartTime,
      git,
      extensionStatuses: footerDataRef?.getExtensionStatuses() ?? new Map(),
      options: preset.segmentOptions ?? {},
      theme,
      colors,
    };
  }

  // ── Welcome lifecycle ─────────────────────────────────────
  function doWelcomeDismiss(ctx: any): void {
    if (dismissWelcome) { dismissWelcome(); dismissWelcome = null; }
    else { shouldDismissEarly = true; }
    if (welcomeHeaderActive) { welcomeHeaderActive = false; ctx.ui.setHeader(undefined); }
  }

  function startWelcomeOverlay(ctx: any): void {
    const modelName    = ctx.model?.name || ctx.model?.id || "No model";
    const providerName = ctx.model?.provider || "Unknown";
    const counts       = discoverLoadedCounts();
    const sessions     = getRecentSessions(3);

    setTimeout(() => {
      if (!enabled || shouldDismissEarly || isStreaming) {
        shouldDismissEarly = false;
        return;
      }
      const events = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = events.some((e: any) =>
        (e.type === "message" && e.message?.role === "assistant") ||
        e.type === "tool_call" || e.type === "tool_result",
      );
      if (hasActivity) return;

      ctx.ui.custom(
        (_tui: any, _theme: any, _kb: any, done: (r: void) => void) => {
          const overlay = new WelcomeOverlay(modelName, providerName, sessions, counts);
          let dismissed = false;

          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            dismissWelcome = null;
            done();
          };

          dismissWelcome = dismiss;
          if (shouldDismissEarly) { shouldDismissEarly = false; dismiss(); }

          return {
            focused: false,
            invalidate: () => overlay.invalidate(),
            render: (w: number) => overlay.render(w),
            handleInput: () => dismiss(),
            dispose: () => { dismissed = true; },
          };
        },
        { overlay: true, overlayOptions: () => ({ verticalAlign: "center", horizontalAlign: "center" }) },
      ).catch(() => {});
    }, 100);
  }

  // ── Editor setup ──────────────────────────────────────────
  function setupEditor(ctx: any): void {
    snapshotHistory(currentEditor);

    let autocompleteFixed = false;

    const editorFactory = (tui: any, editorTheme: any, keybindings: any) => {
      const editor = new CustomEditor(tui, editorTheme, keybindings);
      currentEditor = editor;
      trackHistory(editor);
      restoreHistory(editor);

      const origInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        if (!autocompleteFixed && !(editor as any).autocompleteProvider) {
          autocompleteFixed = true;
          snapshotHistory(editor);
          ctx.ui.setEditorComponent(editorFactory);
          currentEditor?.handleInput(data);
          return;
        }
        setTimeout(() => doWelcomeDismiss(ctx), 0);
        origInput(data);
      };

      const origRender = editor.render.bind(editor);
      editor.render = (width: number): string[] => {
        if (width < 10) return origRender(width);

        const bc     = (s: string) => `${getFgAnsiCode("sep")}${s}${ansi.reset}`;
        const prompt = `${ansi.getFgAnsi(200, 200, 200)}>${ansi.reset}`;
        const prefix = ` ${prompt} `;
        const cont   = "   ";
        const cw     = Math.max(1, width - 3);
        const lines  = origRender(cw);

        if (lines.length === 0 || !currentCtx) return lines;

        // Find bottom border
        let bottomIdx = lines.length - 1;
        for (let i = lines.length - 1; i >= 1; i--) {
          const stripped = (lines[i] ?? "").replace(/\x1b\[[0-9;]*m/g, "");
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) { bottomIdx = i; break; }
        }

        const result: string[] = [];
        const layout = getCachedLayout(width, ctx.ui.theme);
        for (const line of layout.topLines) result.push(line);
        result.push(" " + bc("─".repeat(width - 2)));

        for (let i = 1; i < bottomIdx; i++) {
          result.push(`${i === 1 ? prefix : cont}${lines[i] || ""}`);
        }
        if (bottomIdx === 1) result.push(`${prefix}${" ".repeat(cw)}`);

        result.push(" " + bc("─".repeat(width - 2)));
        for (let i = bottomIdx + 1; i < lines.length; i++) result.push(lines[i] || "");
        return result;
      };

      return editor;
    };

    if (!enabled) return;
    ctx.ui.setEditorComponent(editorFactory);

    // Footer — subscribe to git branch / extension statuses, feed tuiRef
    ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataRef = footerData;
      tuiRef = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(): string[] { return []; },
      };
    });

    // Secondary row widget (overflow segments)
    ctx.ui.setWidget("statusbar-secondary", (_tui: any, theme: Theme) => ({
      dispose() {},
      invalidate() {},
      render(w: number): string[] {
        if (!currentCtx) return [];
        const layout = getCachedLayout(w, theme);
        return layout.secondaryContent ? [layout.secondaryContent] : [];
      },
    }), { placement: "belowEditor" });

    // Notification-style extension statuses (above editor)
    ctx.ui.setWidget("statusbar-notifications", () => ({
      dispose() {},
      invalidate() {},
      render(w: number): string[] {
        if (!currentCtx || !footerDataRef) return [];
        const statuses = footerDataRef.getExtensionStatuses();
        const out: string[] = [];
        for (const v of statuses.values()) {
          if (v?.trimStart().startsWith("[") && visibleWidth(` ${v}`) <= w) {
            out.push(` ${v}`);
          }
        }
        return out;
      },
    }), { placement: "aboveEditor" });

    // Last-prompt reminder (below editor)
    ctx.ui.setWidget("statusbar-last-prompt", () => ({
      dispose() {},
      invalidate() {},
      render(w: number): string[] {
        if (!showLastPrompt || !lastUserPrompt) return [];
        const prefix = `${getFgAnsiCode("sep")}↳${ansi.reset} `;
        const avail  = w - 3;
        if (avail < 10) return [];
        let text = lastUserPrompt.replace(/\s+/g, " ").trim();
        if (!text) return [];
        if (visibleWidth(text) > avail) {
          let out = ""; let ow = 0;
          for (const ch of text) {
            const cw = visibleWidth(ch);
            if (ow + cw > avail - 1) break;
            out += ch; ow += cw;
          }
          text = out.trimEnd() + "…";
        }
        return [` ${prefix}${getFgAnsiCode("sep")}${text}${ansi.reset}`];
      },
    }), { placement: "belowEditor" });
  }

  function teardownEditor(ctx: any): void {
    ctx.ui.setEditorComponent(undefined);
    ctx.ui.setFooter(undefined);
    ctx.ui.setHeader(undefined);
    ctx.ui.setWidget("statusbar-secondary", undefined);
    ctx.ui.setWidget("statusbar-notifications", undefined);
    ctx.ui.setWidget("statusbar-last-prompt", undefined);
    footerDataRef = null;
    tuiRef = null;
    currentEditor = null;
    invalidateLayout();
  }

  // ── Clock ticker ──────────────────────────────────────────
  function startClock(): void {
    stopClock();
    // Only tick if the current preset uses a time segment
    const preset = getPreset(currentPreset);
    const allSegs = [
      ...preset.leftSegments, ...preset.rightSegments, ...(preset.secondarySegments ?? []),
    ];
    if (!allSegs.includes("time")) return;
    clockInterval = setInterval(() => {
      invalidateLayout();
      tuiRef?.requestRender();
    }, 1000);
  }

  function stopClock(): void {
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  }

  // ── Select overlay helper ─────────────────────────────────
  function selectTheme(theme: Theme) {
    return {
      selectedPrefix: (t: string) => theme.fg("accent", t),
      selectedText:   (t: string) => theme.fg("accent", t),
      description:    (t: string) => theme.fg("muted", t),
      scrollInfo:     (t: string) => theme.fg("dim", t),
      noMatch:        (t: string) => theme.fg("warning", t),
    };
  }

  async function showSelect(
    ctx: any,
    title: string,
    hint: string,
    items: SelectItem[],
    maxVisible: number,
  ): Promise<SelectItem | null> {
    return ctx.ui.custom<SelectItem | null>(
      (tui: any, theme: Theme, _kb: any, done: (r: SelectItem | null) => void) => {
        const list   = new SelectList(items, maxVisible, selectTheme(theme));
        const border = (t: string) => theme.fg("dim", t);
        const row    = (t: string, w: number) =>
          `${border("│")}${truncateToWidth(t, w, "…", true)}${border("│")}`;

        list.onSelect = (item) => done(item);
        list.onCancel = () => done(null);

        return {
          render(width: number): string[] {
            const iw = Math.max(1, width - 2);
            return [
              border(`╭${"─".repeat(iw)}╮`),
              row(theme.fg("accent", theme.bold(title)), iw),
              border(`├${"─".repeat(iw)}┤`),
              ...list.render(iw).map((l) => row(l, iw)),
              border(`├${"─".repeat(iw)}┤`),
              row(theme.fg("dim", hint), iw),
              border(`╰${"─".repeat(iw)}╯`),
            ];
          },
          invalidate: () => list.invalidate(),
          handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
        };
      },
      { overlay: true, overlayOptions: () => ({ verticalAlign: "center", horizontalAlign: "center" }) },
    );
  }

  // ── Stash UI ──────────────────────────────────────────────
  async function openStashHistory(ctx: any): Promise<void> {
    let projectPrompts: string[] = [];
    try { projectPrompts = readProjectPrompts(ctx.cwd); } catch { /* ignore */ }

    if (stashHistory.length === 0 && projectPrompts.length === 0) {
      ctx.ui.notify("No prompt history yet", "info");
      return;
    }

    // Pick source if both available
    let source: "stash" | "project" = "stash";
    if (stashHistory.length > 0 && projectPrompts.length > 0) {
      const sourceItems: SelectItem[] = [
        { value: "stash",   label: "Stashed prompts",        description: `${stashHistory.length} saved` },
        { value: "project", label: "Recent project prompts", description: `${projectPrompts.length} recent` },
      ];
      const picked = await showSelect(ctx, "Prompt history", "↑↓ navigate • enter open • esc cancel", sourceItems, 2);
      if (!picked) return;
      source = picked.value === "project" ? "project" : "stash";
    } else if (projectPrompts.length > 0) {
      source = "project";
    }

    const pool   = source === "project" ? projectPrompts : stashHistory;
    const items: SelectItem[] = pool.map((e, i) => ({
      value: String(i),
      label: `#${i + 1} ${buildPreview(e, STASH_PREVIEW_WIDTH)}`,
    }));

    const selected = await showSelect(
      ctx,
      source === "project" ? "Recent project prompts" : "Stash history",
      "↑↓ navigate • enter insert • esc cancel",
      items,
      Math.min(items.length, 10),
    );
    if (!selected) return;

    const entry = pool[Number.parseInt(selected.value, 10)];
    if (!entry) return;

    const current = getEditorText(ctx);
    if (!hasText(current)) {
      ctx.ui.setEditorText(entry);
      ctx.ui.notify("Inserted prompt", "info");
      return;
    }

    const action = await ctx.ui.select("Insert prompt", ["Replace", "Append", "Cancel"]);
    if (action === "Replace") { ctx.ui.setEditorText(entry); ctx.ui.notify("Replaced editor with prompt", "info"); }
    else if (action === "Append") {
      const sep = current.endsWith("\n") || entry.startsWith("\n") ? "" : "\n";
      ctx.ui.setEditorText(`${current}${sep}${entry}`);
      ctx.ui.notify("Appended prompt", "info");
    }
  }

  function buildPreview(text: string, maxWidth: number): string {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact) return "(empty)";
    if (visibleWidth(compact) <= maxWidth) return compact;
    let out = ""; let w = 0;
    for (const ch of compact) {
      const cw = visibleWidth(ch);
      if (w + cw > maxWidth - 1) break;
      out += ch; w += cw;
    }
    return out.trimEnd() + "…";
  }

  // ── Profile UI ────────────────────────────────────────────
  function getLiveProfileIdx(ctx: any, profiles: ProfileConfig[]): number | null {
    if (!ctx.model?.provider || !ctx.model?.id) return null;
    return findMatchingProfileIndex(profiles, ctx.model.provider, ctx.model.id, pi.getThinkingLevel());
  }

  async function switchToProfile(ctx: any, profiles: ProfileConfig[], idx: number): Promise<boolean> {
    const profile = profiles[idx];
    if (!profile) return false;
    const spec = parseModelSpec(profile.model);
    if (!spec) return false;
    const model = ctx.modelRegistry.find(spec.provider, spec.modelId);
    if (!model) { ctx.ui.notify(`Model not found: ${profile.model}`, "warning"); return false; }
    const switched = await pi.setModel(model);
    if (!switched) { ctx.ui.notify(`No API key for: ${profile.model}`, "warning"); return false; }
    pi.setThinkingLevel(profile.thinking);
    setActiveProfileIndex(idx);
    invalidateLayout();
    const level = pi.getThinkingLevel();
    ctx.ui.notify(`Switched to: ${getProfileDisplayName(profile, model.name)} [${level}]`, "info");
    tuiRef?.requestRender();
    return true;
  }

  async function withProfileLock(fn: () => Promise<void>): Promise<void> {
    if (profileSwitchLock) return;
    profileSwitchLock = true;
    try { await fn(); } finally { profileSwitchLock = false; }
  }

  async function openProfileSelector(ctx: any, profiles: ProfileConfig[]): Promise<void> {
    if (profiles.length === 0) {
      ctx.ui.notify("No profiles. Use /profile add to create one.", "info");
      return;
    }
    const active = getLiveProfileIdx(ctx, profiles);
    const items: SelectItem[] = profiles.map((p, i) => {
      const spec  = parseModelSpec(p.model);
      const model = spec ? ctx.modelRegistry.find(spec.provider, spec.modelId) : undefined;
      return {
        value: String(i),
        label: `#${i + 1}  ${getProfileDisplayName(p, model?.name)}${i === active ? " ✓" : ""}`,
        description: `${p.model}  [${p.thinking}]`,
      };
    });
    const selected = await showSelect(ctx, "Model profiles", "↑↓ navigate • enter switch • esc close", items, Math.min(items.length, 12));
    if (!selected) return;
    const i = Number.parseInt(selected.value, 10);
    await withProfileLock(() => switchToProfile(ctx, profiles, i));
  }

  async function pickModelFromRegistry(ctx: any): Promise<{ provider: string; id: string; name: string } | null> {
    const available = ctx.modelRegistry.getAvailable();
    if (available.length === 0) { ctx.ui.notify("No models available", "warning"); return null; }

    type Entry = { provider: string; id: string; name: string; key: string };
    const all: Entry[] = available.map((m: any) => ({
      provider: m.provider, id: m.id, name: m.name || m.id, key: `${m.provider}/${m.id}`,
    }));

    return ctx.ui.custom<Entry | null>(
      (tui: any, theme: Theme, _kb: any, done: (r: Entry | null) => void) => {
        const lt = selectTheme(theme);
        const border = (t: string) => theme.fg("dim", t);
        const row    = (t: string, w: number) => `${border("│")}${truncateToWidth(t, w, "…", true)}${border("│")}`;
        const search = new Input();
        let query = "";
        let filtered = all;
        let list = new SelectList(toItems(all), Math.min(all.length, 12), lt);
        wire();

        function toItems(entries: Entry[]): SelectItem[] {
          return entries.map((e) => ({ value: e.key, label: e.name, description: e.provider }));
        }
        function wire() {
          list.onSelect = (item) => done(filtered.find((e) => e.key === item.value) ?? null);
          list.onCancel = () => done(null);
        }
        function applyFilter(q: string) {
          filtered = q ? fuzzyFilter(all, q, (e) => `${e.name} ${e.provider} ${e.id}`) : all;
          list = new SelectList(toItems(filtered), Math.min(filtered.length, 12), lt);
          wire();
        }

        return {
          render(width: number): string[] {
            const iw = Math.max(1, width - 2);
            return [
              border(`╭${"─".repeat(iw)}╮`),
              row(theme.fg("accent", theme.bold("Select model")), iw),
              border(`├${"─".repeat(iw)}┤`),
              row(` ${theme.fg("muted", "/")} ${query}`, iw),
              border(`├${"─".repeat(iw)}┤`),
              ...list.render(iw).map((l) => row(l, iw)),
              border(`├${"─".repeat(iw)}┤`),
              row(theme.fg("dim", "type to filter • enter select • esc cancel"), iw),
              border(`╰${"─".repeat(iw)}╯`),
            ];
          },
          invalidate: () => list.invalidate(),
          handleInput: (data: string) => {
            const before = list.getSelectedItem();
            list.handleInput(data);
            if (before === list.getSelectedItem()) {
              search.handleInput(data);
              const next = search.getValue();
              if (next !== query) { query = next; applyFilter(query); }
            }
            tui.requestRender();
          },
        };
      },
      { overlay: true, overlayOptions: () => ({ verticalAlign: "center", horizontalAlign: "center" }) },
    );
  }

  async function pickThinkingLevel(ctx: any): Promise<ProfileConfig["thinking"] | null> {
    const levels: ProfileConfig["thinking"][] = ["off","minimal","low","medium","high","xhigh"];
    const items: SelectItem[] = levels.map((l) => ({ value: l, label: l }));
    const s = await showSelect(ctx, "Select thinking level", "↑↓ navigate • enter select • esc cancel", items, levels.length);
    return s ? (s.value as ProfileConfig["thinking"]) : null;
  }

  async function interactiveAddProfile(ctx: any): Promise<void> {
    const model    = await pickModelFromRegistry(ctx);
    if (!model) return;
    const thinking = await pickThinkingLevel(ctx);
    if (!thinking) return;
    const label    = await ctx.ui.input("Profile label (optional)", "e.g. Opus Deep");

    const profiles = reloadProfiles();
    const profile: ProfileConfig = { model: `${model.provider}/${model.id}`, thinking, ...(label ? { label } : {}) };
    const next = [...profiles, profile];
    if (!saveProfiles(next)) { ctx.ui.notify("Failed to save profile", "warning"); return; }
    ctx.ui.notify(`Added profile #${next.length}: ${label || model.name} [${thinking}]`, "info");
  }

  // ═══════════════════════════════════════════════════════════
  // Lifecycle events
  // ═══════════════════════════════════════════════════════════

  pi.on("session_start", async (event, ctx) => {
    sessionStartTime = Date.now();
    currentCtx       = ctx;
    lastUserPrompt   = "";
    isStreaming       = false;
    stashedText       = null;
    invalidateLayout();

    const settings   = readSettings();
    showLastPrompt   = settings.showLastPrompt !== false;
    currentPreset    = normalizePreset(settings.statusBar) ?? "default";
    stashHistory     = readStashHistory();
    getThinkingLevelFn = typeof ctx.getThinkingLevel === "function" ? () => ctx.getThinkingLevel() : null;

    if (ctx.hasUI) ctx.ui.setStatus("stash", undefined);

    reloadProfiles();
    const profileIdx = ctx.model?.provider && ctx.model?.id
      ? findMatchingProfileIndex(getProfilesCache(), ctx.model.provider, ctx.model.id, pi.getThinkingLevel())
      : null;
    setActiveProfileIndex(profileIdx);

    if (enabled && ctx.hasUI) {
      setupEditor(ctx);
      startClock();
      if (event.reason === "startup") startWelcomeOverlay(ctx);
      else doWelcomeDismiss(ctx);
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") invalidateGitStatus();
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeBranch(cmd)) {
        invalidateGitStatus();
        invalidateGitBranch();
        setTimeout(() => tuiRef?.requestRender(), 100);
      }
    }
    invalidateLayout();
  });

  pi.on("user_bash", async (event) => {
    if (mightChangeBranch(event.command)) {
      invalidateGitStatus();
      invalidateGitBranch();
      [100, 300, 500].forEach((d) => setTimeout(() => tuiRef?.requestRender(), d));
    }
  });

  pi.on("before_agent_start", async (event) => {
    lastUserPrompt = event.prompt;
  });

  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    doWelcomeDismiss(ctx);
  });

  pi.on("tool_call", async (_event, ctx) => {
    doWelcomeDismiss(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    isStreaming = false;
    invalidateLayout();
    if (ctx.hasUI && stashedText !== null) {
      if (ctx.ui.getEditorText().trim() === "") {
        ctx.ui.setEditorText(stashedText);
        stashedText = null;
        ctx.ui.setStatus("stash", undefined);
        ctx.ui.notify("Stash restored", "info");
      } else {
        ctx.ui.notify("Stash preserved — clear editor then Alt+S to restore", "info");
      }
    }
  });

  pi.on("model_select", async () => {
    invalidateLayout();
    reloadProfiles();
  });

  // ═══════════════════════════════════════════════════════════
  // Commands
  // ═══════════════════════════════════════════════════════════

  pi.registerCommand("statusbar", {
    description: "Toggle or configure the status bar. Usage: /statusbar [preset|info]",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const raw = args?.trim() ?? "";

      // No args → toggle
      if (!raw) {
        enabled = !enabled;
        if (enabled) {
          setupEditor(ctx);
          startClock();
          ctx.ui.notify("Status bar enabled", "info");
        } else {
          stopClock();
          teardownEditor(ctx);
          ctx.ui.setStatus("stash", undefined);
          stashedText = null;
          setActiveProfileIndex(null);
          ctx.ui.notify("Status bar disabled", "info");
        }
        return;
      }

      // Info
      if (raw === "info") {
        const preset = getPreset(currentPreset);
        const lines = [
          `Preset: ${currentPreset}`,
          `Separator: ${preset.separator}`,
          `Left:  ${preset.leftSegments.join(" · ")}`,
          `Right: ${preset.rightSegments.join(" · ")}`,
          ...(preset.secondarySegments?.length
            ? [`Secondary: ${preset.secondarySegments.join(" · ")}`]
            : []),
          `Enabled: ${enabled}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // Preset switch
      const preset = normalizePreset(raw);
      if (preset) {
        currentPreset = preset;
        invalidateLayout();
        if (enabled) setupEditor(ctx);
        startClock();
        const saved = savePreset(preset);
        ctx.ui.notify(`Preset: ${preset}${saved ? "" : " (not persisted)"}`, "info");
        return;
      }

      const list = Object.keys(PRESETS).join(", ");
      ctx.ui.notify(`Available presets: ${list}`, "info");
    },
  });

  pi.registerCommand("stash", {
    description: "Open prompt history picker",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI || !enabled) return;
      await openStashHistory(ctx);
    },
  });

  pi.registerCommand("profile", {
    description: "Manage model profiles. Usage: /profile [add|remove <N>|<N>]",
    handler: async (args, ctx) => {
      const raw      = args?.trim() ?? "";
      const profiles = reloadProfiles();

      // No args → open selector
      if (!raw) { await openProfileSelector(ctx, profiles); return; }

      const parts     = raw.split(/\s+/);
      const sub       = parts[0]?.toLowerCase();

      if (sub === "add") {
        if (parts.length === 1) { await interactiveAddProfile(ctx); return; }
        // /profile add <model> <thinking> [label...]
        const m = raw.match(/^add\s+(\S+)\s+(\S+)([\s\S]*)$/i);
        if (!m) { ctx.ui.notify("Usage: /profile add [<model> <thinking> [label...]]", "error"); return; }
        const model    = m[1];
        const thinking = m[2].toLowerCase();
        if (!parseModelSpec(model)) { ctx.ui.notify("Invalid model. Use: provider/modelId", "error"); return; }
        if (!isThinkingLevel(thinking)) { ctx.ui.notify("Invalid thinking level. Use: off|minimal|low|medium|high|xhigh", "error"); return; }
        const label    = (m[3] ?? "").trim();
        const next     = [...profiles, { model, thinking: thinking as ProfileConfig["thinking"], ...(label ? { label } : {}) }];
        if (!saveProfiles(next)) { ctx.ui.notify("Failed to save profiles", "warning"); return; }
        ctx.ui.notify(`Added profile #${next.length}`, "info");
        return;
      }

      if (sub === "remove") {
        if (parts.length !== 2) { ctx.ui.notify("Usage: /profile remove <number>", "error"); return; }
        const n = Number.parseInt(parts[1], 10);
        if (!Number.isFinite(n) || n < 1 || n > profiles.length) { ctx.ui.notify("Invalid profile number", "error"); return; }
        let activeIdx = getActiveProfileIndex();
        if (activeIdx !== null) {
          if (activeIdx === n - 1) activeIdx = null;
          else if (n - 1 < activeIdx) activeIdx--;
        }
        const next = profiles.filter((_, i) => i !== n - 1);
        if (!saveProfiles(next)) { ctx.ui.notify("Failed to save profiles", "warning"); return; }
        setActiveProfileIndex(activeIdx);
        ctx.ui.notify(`Removed profile #${n}`, "info");
        return;
      }

      const n = Number.parseInt(sub, 10);
      if (Number.isFinite(n) && parts.length === 1) {
        if (n < 1 || n > profiles.length) { ctx.ui.notify("Invalid profile number", "error"); return; }
        await withProfileLock(() => switchToProfile(ctx, profiles, n - 1));
        return;
      }

      ctx.ui.notify("Usage: /profile | /profile add | /profile remove <N> | /profile <N>", "error");
    },
  });

  // ═══════════════════════════════════════════════════════════
  // Shortcuts
  // ═══════════════════════════════════════════════════════════

  // Alt+S — stash toggle
  pi.registerShortcut("alt+s", {
    description: "Stash / restore editor text",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      const text    = getEditorText(ctx);
      const hasTxt  = hasText(text);
      const hasStsh = stashedText !== null;

      if (hasTxt && !hasStsh) {
        stashedText = text;
        pushStash(text);
        ctx.ui.setEditorText("");
        ctx.ui.setStatus("stash", "📋 stash");
        ctx.ui.notify("Stashed", "info");
      } else if (!hasTxt && hasStsh) {
        ctx.ui.setEditorText(stashedText!);
        stashedText = null;
        ctx.ui.setStatus("stash", undefined);
        ctx.ui.notify("Stash restored", "info");
      } else if (hasTxt && hasStsh) {
        stashedText = text;
        pushStash(text);
        ctx.ui.setEditorText("");
        ctx.ui.setStatus("stash", "📋 stash");
        ctx.ui.notify("Stash updated", "info");
      } else {
        ctx.ui.notify("Nothing to stash", "info");
      }
    },
  });

  pi.registerShortcut(shortcuts.stashHistory, {
    description: "Open stash / prompt history",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      await openStashHistory(ctx);
    },
  });

  pi.registerShortcut(shortcuts.copyEditor, {
    description: "Copy editor text to clipboard",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      const text = getEditorText(ctx);
      if (!hasText(text)) { ctx.ui.notify("Editor is empty", "info"); return; }
      copyToClipboard(text);
      ctx.ui.notify("Copied editor text", "info");
    },
  });

  pi.registerShortcut(shortcuts.cutEditor, {
    description: "Cut editor text to clipboard",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      const text = getEditorText(ctx);
      if (!hasText(text)) { ctx.ui.notify("Editor is empty", "info"); return; }
      copyToClipboard(text);
      ctx.ui.setEditorText("");
      ctx.ui.notify("Cut editor text", "info");
    },
  });

  pi.registerShortcut(shortcuts.profileCycle, {
    description: "Cycle to next model profile",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      await withProfileLock(async () => {
        const profiles = reloadProfiles();
        if (profiles.length === 0) return;
        const current = getLiveProfileIdx(ctx, profiles);
        const start   = current !== null ? (current + 1) % profiles.length : 0;
        for (let attempt = 0; attempt < profiles.length; attempt++) {
          const idx = (start + attempt) % profiles.length;
          if (await switchToProfile(ctx, profiles, idx)) return;
        }
        ctx.ui.notify("No available profiles", "warning");
      });
    },
  });

  pi.registerShortcut(shortcuts.profileSelect, {
    description: "Open model profile selector",
    handler: async (ctx) => {
      if (!enabled || !ctx.hasUI) return;
      await withProfileLock(async () => {
        const profiles = reloadProfiles();
        await openProfileSelector(ctx, profiles);
      });
    },
  });
}
