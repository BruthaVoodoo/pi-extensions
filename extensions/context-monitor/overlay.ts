import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { estimateTokens, formatTokens, getUsageColor } from "./utils.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface Category {
  label: string;
  value: number;
  /** A theme color key — e.g. "success", "accent", "muted" */
  colorKey: string;
  isAvailable?: boolean;
}

export interface OverlayData {
  tokens: number;
  contextWindow: number;
  categories: Category[];
  modelName: string;
}

// The theme object that comes from ctx.ui.custom()'s callback
type Theme = {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
};

// ─────────────────────────────────────────────────────────────
// Rendering helpers
// ─────────────────────────────────────────────────────────────

/**
 * Renders a horizontal bar where the filled portion is colored with
 * `filledColor` and the remainder is dimmed.
 */
function renderSplitBar(
  pct: number,
  width: number,
  filledColor: string,
  theme: Theme,
): string {
  const filled = Math.min(Math.round(pct * width), width);
  const empty = width - filled;
  let result = "";
  if (filled > 0) result += theme.fg(filledColor, "█".repeat(filled));
  if (empty > 0) result += theme.fg("dim", "░".repeat(empty));
  return result;
}

// ─────────────────────────────────────────────────────────────
// Overlay component
// ─────────────────────────────────────────────────────────────

class ContextOverlay {
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private data: OverlayData,
    private theme: Theme,
    private onClose: () => void,
    private onCompact: () => void,
  ) {}

  handleInput(data: string): void {
    if (data === "c" || data === "C") {
      this.onClose();
      this.onCompact();
    } else {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedLines = this.buildLines(width);
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private buildLines(width: number): string[] {
    const t = this.theme;
    const { tokens, contextWindow, categories, modelName } = this.data;
    // Compute pct locally — never trust the stored percent field to be non-null
    const pct = isFinite(tokens / contextWindow) ? tokens / contextWindow : 0;
    const percent = pct * 100;
    const usageColor = getUsageColor(pct);
    const PAD = 2;
    const inner = Math.max(20, width - PAD * 2);
    const lines: string[] = [];

    // ── top border ──────────────────────────────────────────
    lines.push(t.fg("accent", "─".repeat(width)));

    // ── title + model ────────────────────────────────────────
    const title = " " + t.fg("accent", t.bold("Context Monitor"));
    const model = t.fg("dim", modelName) + " ";
    const gap = Math.max(1, width - visibleWidth(title) - visibleWidth(model));
    lines.push(truncateToWidth(title + " ".repeat(gap) + model, width));

    // ── spacer ───────────────────────────────────────────────
    lines.push("");

    // ── total usage bar ──────────────────────────────────────
    const tokStr = `${formatTokens(tokens)} / ${formatTokens(contextWindow)}`;
    const barWidth = Math.max(10, inner - tokStr.length - 2);
    const totalBar = renderSplitBar(pct, barWidth, usageColor, t);
    lines.push(
      truncateToWidth(
        " ".repeat(PAD) + totalBar + "  " + t.fg("text", t.bold(tokStr)),
        width,
      ),
    );

    // ── pct label ────────────────────────────────────────────
    lines.push(" ".repeat(PAD) + t.fg(usageColor, t.bold(`${percent.toFixed(1)}% used`)));

    // ── spacer ───────────────────────────────────────────────
    lines.push("");

    // ── separator ────────────────────────────────────────────
    lines.push(" ".repeat(PAD) + t.fg("borderMuted", "─".repeat(inner)));

    // ── category rows ────────────────────────────────────────
    const LABEL_W = 16;
    const CAT_BAR_W = 20;

    for (const cat of categories) {
      const catPct = isFinite(cat.value / contextWindow) ? cat.value / contextWindow : 0;
      const icon = cat.isAvailable ? "□" : "■";

      const catBar = cat.isAvailable
        ? t.fg("dim", "░".repeat(CAT_BAR_W))
        : renderSplitBar(catPct, CAT_BAR_W, cat.colorKey, t);

      const label = cat.label.padEnd(LABEL_W);
      const val = formatTokens(cat.value).padStart(7);
      const rowPct = `${(catPct * 100).toFixed(1).padStart(5)}%`;

      const row =
        " ".repeat(PAD) +
        t.fg(cat.colorKey, icon) +
        " " +
        t.fg("text", label) +
        " " +
        catBar +
        " " +
        t.fg("accent", val) +
        " " +
        t.fg("muted", rowPct);

      lines.push(truncateToWidth(row, width));
    }

    // ── separator ────────────────────────────────────────────
    lines.push(" ".repeat(PAD) + t.fg("borderMuted", "─".repeat(inner)));

    // ── spacer ───────────────────────────────────────────────
    lines.push("");

    // ── keyboard hints ───────────────────────────────────────
    lines.push(" ".repeat(PAD) + t.fg("dim", "[c] compact   [any] close"));

    // ── bottom border ────────────────────────────────────────
    lines.push(t.fg("accent", "─".repeat(width)));

    return lines;
  }
}

// ─────────────────────────────────────────────────────────────
// Data collection
// ─────────────────────────────────────────────────────────────

async function collectData(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<OverlayData | null> {
  const usage = ctx.getContextUsage();
  if (!usage) return null;
  if (
    usage.tokens == null ||
    usage.contextWindow == null ||
    !isFinite(usage.tokens) ||
    !isFinite(usage.contextWindow) ||
    usage.contextWindow === 0
  ) return null;

  const sm = ctx.sessionManager as any;
  const branch: any[] = Array.isArray(sm?.getBranch?.()) ? sm.getBranch() : [];
  const systemPrompt = ctx.getSystemPrompt();
  const allTools = pi.getAllTools();
  const activeNames = pi.getActiveTools();
  const activeToolDefs = allTools.filter((t) => activeNames.includes(t.name));

  // ── estimate token breakdown from session messages ──────────
  let msgTokensRaw = 0;
  let toolCallTokensRaw = 0;
  let toolResultTokensRaw = 0;

  for (const entry of branch) {
    if (entry.type === "message") {
      const m = entry.message;

      if (m.role === "user") {
        if (typeof m.content === "string") {
          msgTokensRaw += estimateTokens(m.content);
        } else if (Array.isArray(m.content)) {
          for (const p of m.content)
            if (p.type === "text") msgTokensRaw += estimateTokens(p.text);
        }
      } else if (m.role === "assistant") {
        if (typeof m.content === "string") {
          msgTokensRaw += estimateTokens(m.content);
        } else if (Array.isArray(m.content)) {
          for (const p of m.content) {
            if (p.type === "text") msgTokensRaw += estimateTokens(p.text);
            if (p.type === "toolCall") toolCallTokensRaw += estimateTokens(JSON.stringify(p));
          }
        }
      } else if (m.role === "toolResult") {
        if (Array.isArray(m.content)) {
          for (const p of m.content)
            if (p.type === "text") toolResultTokensRaw += estimateTokens(p.text);
        }
      } else if (m.role === "bashExecution") {
        toolCallTokensRaw += estimateTokens(m.command ?? "");
      }
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      msgTokensRaw += estimateTokens(entry.summary ?? "");
    }
  }

  // ── scale estimated values to match actual reported token count ──
  const systemTokensRaw = estimateTokens(systemPrompt);
  const toolDefTokensRaw = estimateTokens(JSON.stringify(activeToolDefs));
  const totalRaw =
    systemTokensRaw + toolDefTokensRaw + msgTokensRaw + toolCallTokensRaw + toolResultTokensRaw;
  const ratio = totalRaw > 0 ? usage.tokens / totalRaw : 1;

  const systemTokens = Math.round(systemTokensRaw * ratio);
  const toolDefTokens = Math.round(toolDefTokensRaw * ratio);
  const msgTokens = Math.round(msgTokensRaw * ratio);
  const toolCallTokens = Math.round((toolCallTokensRaw + toolResultTokensRaw) * ratio);

  const accounted = systemTokens + toolDefTokens + msgTokens + toolCallTokens;
  const otherTokens = Math.max(0, usage.tokens - accounted);
  const available = Math.max(0, usage.contextWindow - usage.tokens);

  const categories: Category[] = [
    { label: "System Prompt", value: systemTokens, colorKey: "muted" },
    { label: "System Tools", value: toolDefTokens, colorKey: "dim" },
    { label: "Tool Calls", value: toolCallTokens, colorKey: "success" },
    { label: "Messages", value: msgTokens, colorKey: "accent" },
  ];

  if (otherTokens > 100) {
    categories.push({ label: "Other", value: otherTokens, colorKey: "warning" });
  }

  categories.push({
    label: "Available",
    value: available,
    colorKey: "borderMuted",
    isAvailable: true,
  });

  const model = ctx.model;
  const modelName = model ? model.id : "unknown model";

  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    categories,
    modelName,
  };
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

export async function showContextOverlay(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const data = await collectData(pi, ctx);

  if (!data) {
    ctx.ui.notify("No context usage available yet — run a prompt first.", "warning");
    return;
  }

  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const overlay = new ContextOverlay(
        data,
        theme as unknown as Theme,
        () => done(undefined),
        () => {
          ctx.compact({
            onComplete: () => ctx.ui.notify("Compaction complete ✓", "success"),
            onError: (e) => ctx.ui.notify(`Compaction failed: ${e.message}`, "error"),
          });
        },
      );

      return {
        render: (w) => overlay.render(w),
        invalidate: () => overlay.invalidate(),
        handleInput: (input) => {
          overlay.handleInput(input);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        minWidth: 72,
        maxHeight: "90%",
        anchor: "center",
      },
    },
  );
}
