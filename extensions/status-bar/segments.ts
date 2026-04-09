import { hostname as osHostname } from "node:os";
import { basename } from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import type {
  RenderedSegment,
  SegmentContext,
  SemanticColor,
  StatusLineSegment,
  StatusLineSegmentId,
} from "./types.js";
import { fg, rainbow, applyColor } from "./theme.js";
import { getIcons, SEP_DOT, getThinkingText } from "./icons.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function color(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
  return fg(ctx.theme, semantic, text, ctx.colors);
}

function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

function formatTokens(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

// ─────────────────────────────────────────────────────────────
// Segment definitions
// ─────────────────────────────────────────────────────────────

const piSegment: StatusLineSegment = {
  id: "pi",
  render(ctx) {
    const icons = getIcons();
    if (!icons.pi) return { content: "", visible: false };
    // Bold makes the symbol render heavier/more prominent
    const bold = `\x1b[1m${icons.pi}\x1b[22m`;
    return { content: color(ctx, "pi", `${bold} `), visible: true };
  },
};

const modelSegment: StatusLineSegment = {
  id: "model",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.model ?? {};
    let content: string;

    if (ctx.activeProfileIndex !== null && ctx.activeProfileLabel) {
      content = withIcon(icons.model, ctx.activeProfileLabel);
    } else {
      let name = ctx.model?.name || ctx.model?.id || "no-model";
      if (name.startsWith("Claude ")) name = name.slice(7);
      content = withIcon(icons.model, name);

      if (opts.showThinkingLevel !== false && ctx.model?.reasoning) {
        const level = ctx.thinkingLevel || "off";
        if (level !== "off") {
          const t = getThinkingText(level);
          if (t) content += `${SEP_DOT}${t}`;
        }
      }

      if (ctx.activeProfileIndex !== null) content += ` (P${ctx.activeProfileIndex + 1})`;
    }

    return { content: color(ctx, "model", content), visible: true };
  },
};

const pathSegment: StatusLineSegment = {
  id: "path",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.path ?? {};
    const mode = opts.mode ?? "basename";
    let pwd = process.cwd();
    const home = process.env.HOME || process.env.USERPROFILE;

    if (mode === "basename") {
      pwd = basename(pwd) || pwd;
    } else {
      if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
      if (pwd.startsWith("/work/")) pwd = pwd.slice(6);
      if (mode === "abbreviated") {
        const max = opts.maxLength ?? 40;
        if (pwd.length > max) pwd = `…${pwd.slice(-(max - 1))}`;
      }
    }

    return { content: color(ctx, "path", withIcon(icons.folder, pwd)), visible: true };
  },
};

const gitSegment: StatusLineSegment = {
  id: "git",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.git ?? {};
    const { branch, staged, unstaged, untracked } = ctx.git;
    const hasDiffs = staged > 0 || unstaged > 0 || untracked > 0;
    if (!branch && !hasDiffs) return { content: "", visible: false };

    const isDirty = hasDiffs;
    let content = "";

    if (opts.showBranch !== false && branch) {
      content = color(ctx, isDirty ? "gitDirty" : "gitClean", withIcon(icons.branch, branch));
    }

    const indicators: string[] = [];
    if (opts.showUnstaged !== false && unstaged > 0)
      indicators.push(applyColor(ctx.theme, "warning", `*${unstaged}`));
    if (opts.showStaged !== false && staged > 0)
      indicators.push(applyColor(ctx.theme, "success", `+${staged}`));
    if (opts.showUntracked !== false && untracked > 0)
      indicators.push(applyColor(ctx.theme, "muted", `?${untracked}`));

    if (indicators.length > 0) {
      const ind = indicators.join(" ");
      content = content ? `${content} ${ind}` : ind;
    }

    if (!content) return { content: "", visible: false };
    return { content, visible: true };
  },
};

const thinkingSegment: StatusLineSegment = {
  id: "thinking",
  render(ctx) {
    const level = ctx.thinkingLevel || "off";
    const labels: Record<string, string> = {
      off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhigh",
    };
    const text = `think:${labels[level] ?? level}`;
    if (level === "high" || level === "xhigh") return { content: rainbow(text), visible: true };
    return { content: color(ctx, "thinking", text), visible: true };
  },
};

const tokenInSegment: StatusLineSegment = {
  id: "token_in",
  render(ctx) {
    const icons = getIcons();
    const { input } = ctx.usageStats;
    if (!input) return { content: "", visible: false };
    return { content: color(ctx, "tokens", withIcon(icons.input, formatTokens(input))), visible: true };
  },
};

const tokenOutSegment: StatusLineSegment = {
  id: "token_out",
  render(ctx) {
    const icons = getIcons();
    const { output } = ctx.usageStats;
    if (!output) return { content: "", visible: false };
    return { content: color(ctx, "tokens", withIcon(icons.output, formatTokens(output))), visible: true };
  },
};

const tokenTotalSegment: StatusLineSegment = {
  id: "token_total",
  render(ctx) {
    const icons = getIcons();
    const { input, output, cacheRead, cacheWrite } = ctx.usageStats;
    const total = input + output + cacheRead + cacheWrite;
    if (!total) return { content: "", visible: false };
    return { content: color(ctx, "tokens", withIcon(icons.tokens, formatTokens(total))), visible: true };
  },
};

const costSegment: StatusLineSegment = {
  id: "cost",
  render(ctx) {
    const { cost } = ctx.usageStats;
    // Only show when actually spending money
    if (!cost || ctx.usingSubscription) return { content: "", visible: false };

    // Color thresholds: warn ≥ $0.10, error ≥ $0.50
    const display = `$${cost.toFixed(2)}`;
    const semantic: SemanticColor = cost >= 0.50 ? "costError" : cost >= 0.10 ? "costWarn" : "cost";
    return { content: color(ctx, semantic, display), visible: true };
  },
};

const contextPctSegment: StatusLineSegment = {
  id: "context_pct",
  render(ctx) {
    const icons = getIcons();
    const { contextPercent, contextWindow } = ctx;
    const autoIcon = ctx.autoCompactEnabled && icons.auto ? ` ${icons.auto}` : "";
    const text = `${contextPercent.toFixed(1)}%/${formatTokens(contextWindow)}${autoIcon}`;

    let content: string;
    if (contextPercent > 90) {
      content = withIcon(icons.context, color(ctx, "contextError", text));
    } else if (contextPercent > 70) {
      content = withIcon(icons.context, color(ctx, "contextWarn", text));
    } else {
      content = withIcon(icons.context, color(ctx, "context", text));
    }

    return { content, visible: true };
  },
};

// Visual progress bar — e.g. ▓▓▓▓▓▓░░░░ 64%
const contextBarSegment: StatusLineSegment = {
  id: "context_bar",
  render(ctx) {
    const icons = getIcons();
    const { contextPercent, contextWindow } = ctx;
    if (!contextWindow) return { content: "", visible: false };

    const BAR_WIDTH = 10;
    const filled = Math.round((contextPercent / 100) * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    const bar = "▓".repeat(filled) + "░".repeat(empty);
    const pct = `${Math.round(contextPercent)}%`;
    const autoIcon = ctx.autoCompactEnabled && icons.auto ? ` ${icons.auto}` : "";

    const semantic: SemanticColor =
      contextPercent > 90 ? "contextError" : contextPercent > 70 ? "contextWarn" : "context";

    const content = withIcon(icons.context, color(ctx, semantic, `${bar} ${pct}${autoIcon}`));
    return { content, visible: true };
  },
};

const contextTotalSegment: StatusLineSegment = {
  id: "context_total",
  render(ctx) {
    const icons = getIcons();
    if (!ctx.contextWindow) return { content: "", visible: false };
    return {
      content: color(ctx, "context", withIcon(icons.context, formatTokens(ctx.contextWindow))),
      visible: true,
    };
  },
};

const timeSpentSegment: StatusLineSegment = {
  id: "time_spent",
  render(ctx) {
    const icons = getIcons();
    const elapsed = Date.now() - ctx.sessionStartTime;
    if (elapsed < 1000) return { content: "", visible: false };
    return { content: withIcon(icons.time, formatDuration(elapsed)), visible: true };
  },
};

const timeSegment: StatusLineSegment = {
  id: "time",
  render(ctx) {
    const icons = getIcons();
    const opts = ctx.options.time ?? {};
    const now = new Date();
    let hours = now.getHours();
    let suffix = "";
    if (opts.format === "12h") {
      suffix = hours >= 12 ? "pm" : "am";
      hours = hours % 12 || 12;
    }
    const mins = now.getMinutes().toString().padStart(2, "0");
    let t = `${hours}:${mins}`;
    if (opts.showSeconds) t += `:${now.getSeconds().toString().padStart(2, "0")}`;
    t += suffix;
    return { content: withIcon(icons.time, t), visible: true };
  },
};

const sessionSegment: StatusLineSegment = {
  id: "session",
  render(ctx) {
    const icons = getIcons();
    const display = ctx.sessionId?.slice(0, 8) || "new";
    return { content: withIcon(icons.session, display), visible: true };
  },
};

// Human-readable session name (from sessionManager)
const sessionNameSegment: StatusLineSegment = {
  id: "session_name",
  render(ctx) {
    const name = ctx.sessionName;
    if (!name) return { content: "", visible: false };
    const icons = getIcons();
    const display = name.length > 24 ? `${name.slice(0, 21)}…` : name;
    return { content: color(ctx, "sessionName", withIcon(icons.session, display)), visible: true };
  },
};

const hostnameSegment: StatusLineSegment = {
  id: "hostname",
  render() {
    const icons = getIcons();
    return { content: withIcon(icons.host, osHostname().split(".")[0]), visible: true };
  },
};

const cacheReadSegment: StatusLineSegment = {
  id: "cache_read",
  render(ctx) {
    const icons = getIcons();
    const { cacheRead } = ctx.usageStats;
    if (!cacheRead) return { content: "", visible: false };
    const parts = [icons.cache, icons.input, formatTokens(cacheRead)].filter(Boolean);
    return { content: color(ctx, "tokens", parts.join(" ")), visible: true };
  },
};

const cacheWriteSegment: StatusLineSegment = {
  id: "cache_write",
  render(ctx) {
    const icons = getIcons();
    const { cacheWrite } = ctx.usageStats;
    if (!cacheWrite) return { content: "", visible: false };
    const parts = [icons.cache, icons.output, formatTokens(cacheWrite)].filter(Boolean);
    return { content: color(ctx, "tokens", parts.join(" ")), visible: true };
  },
};

const extensionStatusesSegment: StatusLineSegment = {
  id: "extension_statuses",
  render(ctx) {
    const statuses = ctx.extensionStatuses;
    if (!statuses || statuses.size === 0) return { content: "", visible: false };

    const parts: string[] = [];
    for (const value of statuses.values()) {
      if (value && !value.trimStart().startsWith("[") && visibleWidth(value) > 0) {
        const stripped = value.replace(/(\x1b\[[0-9;]*m|\s|·|[|])+$/, "");
        if (visibleWidth(stripped) > 0) parts.push(stripped);
      }
    }

    if (parts.length === 0) return { content: "", visible: false };
    return { content: parts.join(` ${SEP_DOT} `), visible: true };
  },
};

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────

export const SEGMENTS: Record<StatusLineSegmentId, StatusLineSegment> = {
  pi: piSegment,
  model: modelSegment,
  path: pathSegment,
  git: gitSegment,
  thinking: thinkingSegment,
  token_in: tokenInSegment,
  token_out: tokenOutSegment,
  token_total: tokenTotalSegment,
  cost: costSegment,
  context_pct: contextPctSegment,
  context_bar: contextBarSegment,
  context_total: contextTotalSegment,
  time_spent: timeSpentSegment,
  time: timeSegment,
  session: sessionSegment,
  session_name: sessionNameSegment,
  hostname: hostnameSegment,
  cache_read: cacheReadSegment,
  cache_write: cacheWriteSegment,
  extension_statuses: extensionStatusesSegment,
};

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
  return SEGMENTS[id]?.render(ctx) ?? { content: "", visible: false };
}
