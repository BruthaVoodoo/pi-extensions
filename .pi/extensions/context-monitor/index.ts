import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { showContextOverlay } from "./overlay.js";


// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Thresholds at which we alert the user (one-shot — tracked per session). */
const ALERT_THRESHOLDS = [0.75, 0.9] as const;
const alerted = new Set<number>();

// ─────────────────────────────────────────────────────────────
// Threshold alerts
// ─────────────────────────────────────────────────────────────

function fireThresholdAlerts(ctx: ExtensionContext): void {
  const usage = ctx.getContextUsage();
  if (!usage) return;
  if (
    usage.tokens == null ||
    usage.contextWindow == null ||
    !isFinite(usage.tokens) ||
    !isFinite(usage.contextWindow) ||
    usage.contextWindow === 0
  ) return;

  const pct = usage.tokens / usage.contextWindow;

  for (const threshold of ALERT_THRESHOLDS) {
    if (pct >= threshold && !alerted.has(threshold)) {
      alerted.add(threshold);
      const level = threshold >= 0.9 ? "error" : "warning";
      ctx.ui.notify(
        `Context at ${Math.round(pct * 100)}% — ${threshold >= 0.9 ? "compact now" : "consider /compact"}`,
        level,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Extension entry point
// ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ── Session lifecycle ──────────────────────────────────────

  pi.on("session_start", async (_event, _ctx) => {
    alerted.clear();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    // nothing to clean up
  });

  // ── Agent events — check thresholds after each turn ────────

  pi.on("turn_end", async (_event, ctx) => {
    fireThresholdAlerts(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    fireThresholdAlerts(ctx);
  });

  // ── Model change — reset alert tracking ────────────────────

  pi.on("model_select", async (_event, _ctx) => {
    alerted.clear();
  });

  // ── /context command ───────────────────────────────────────

  pi.registerCommand("context", {
    description: "Show context window usage breakdown",
    handler: async (_args, ctx) => {
      await showContextOverlay(pi, ctx);
    },
  });

  // ── ctrl+shift+c shortcut ──────────────────────────────────

  pi.registerShortcut("ctrl+shift+c", {
    description: "Show context window usage",
    handler: async (ctx) => {
      await showContextOverlay(pi, ctx as unknown as ExtensionContext);
    },
  });
}
