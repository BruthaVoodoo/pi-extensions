/**
 * Session Handoff Extension
 *
 * Extracts structured context from the current session using a configurable
 * (typically cheaper) model, saves a markdown document to /handoff in the
 * project root, then opens a new session with the document pre-filled.
 *
 * Usage:
 *   /handoff implement auth for teams
 *   /handoff fix the race condition in the event loop
 *   /handoff --configure   (re-run model picker and save new default)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

import { extractContext, collectGitInfo } from "./extraction.js";
import { buildHandoffDoc, buildFileName } from "./prompt.js";
import {
  loadExtractionModelConfig,
  saveExtractionModelConfig,
  clearExtractionModelConfig,
  type ExtractionModelConfig,
} from "./config.js";

// ─────────────────────────────────────────────────────────────
// Goal validation
// ─────────────────────────────────────────────────────────────

const VAGUE_GOALS = new Set([
  "continue", "keep going", "more", "next", "proceed",
  "go on", "resume", "carry on", "go", "ok", "okay",
]);

function validateGoal(goal: string): string | null {
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    return "Please provide a goal. Usage: /handoff <what the next session should accomplish>";
  }
  if (VAGUE_GOALS.has(trimmed.toLowerCase())) {
    return `"${trimmed}" is too vague — be specific about what the next session should accomplish.`;
  }
  if (trimmed.length < 10) {
    return "Goal is too short — describe what the next session should accomplish.";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Model picker
// ─────────────────────────────────────────────────────────────

function formatCost(model: Model<any>): string {
  const cost = (model as any).cost;
  if (!cost || (cost.input === 0 && cost.output === 0)) return "free / custom";
  // Costs are stored per-token; multiply by 1M for display
  const inM = (cost.input * 1_000_000).toFixed(2);
  const outM = (cost.output * 1_000_000).toFixed(2);
  return `$${inM} in / $${outM} out per 1M tokens`;
}

/**
 * Shows a model picker for all models that have auth configured.
 * Models are sorted cheapest-first by input token cost.
 * Returns the chosen model, or null if cancelled.
 */
async function pickModel(
  ctx: ExtensionCommandContext,
  currentModel: Model<any> | undefined,
): Promise<Model<any> | null> {
  const available = ctx.modelRegistry.getAvailable();

  if (available.length === 0) {
    ctx.ui.notify("No models with configured API keys found", "error");
    return null;
  }

  // Sort cheapest input cost first; unknown cost goes last
  const sorted = [...available].sort((a, b) => {
    const aC = (a as any).cost?.input ?? Infinity;
    const bC = (b as any).cost?.input ?? Infinity;
    return aC - bC;
  });

  // Build display strings
  const options = sorted.map((m) => {
    const isCurrent = m.provider === currentModel?.provider && m.id === currentModel?.id;
    const tag = isCurrent ? " [current]" : "";
    return `${m.id}  ·  ${m.provider}  ·  ${formatCost(m)}${tag}`;
  });

  const chosen = await ctx.ui.select(
    "Choose extraction model for /handoff (saved globally)",
    options,
  );

  if (!chosen) return null;

  const idx = options.indexOf(chosen);
  return sorted[idx] ?? null;
}

// ─────────────────────────────────────────────────────────────
// Resolve extraction model (load saved or prompt to pick)
// ─────────────────────────────────────────────────────────────

/**
 * Returns the model to use for extraction.
 * Priority: saved config → picker (first-time setup).
 * Returns null if the user cancels the picker.
 */
async function resolveExtractionModel(
  ctx: ExtensionCommandContext,
  forceReconfigure: boolean,
): Promise<Model<any> | null> {
  if (!forceReconfigure) {
    const saved = loadExtractionModelConfig();
    if (saved) {
      const model = ctx.modelRegistry.find(saved.provider, saved.id);
      if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
        return model;
      }
      // Saved model no longer has auth — fall through to picker
      if (model) {
        ctx.ui.notify(
          `Saved extraction model (${saved.id}) no longer has auth — please pick a new one`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `Saved extraction model (${saved.id}) not found — please pick a new one`,
          "warning",
        );
      }
    }
  }

  // First time (or reconfigure) — run the picker
  const picked = await pickModel(ctx, ctx.model);
  if (!picked) return null;

  // Save globally for all future handoffs
  saveExtractionModelConfig({ provider: picked.provider, id: picked.id });
  ctx.ui.notify(`Extraction model set to ${picked.id} — saved globally`, "success");

  return picked;
}

// ─────────────────────────────────────────────────────────────
// Extension entry point
// ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff", {
    description: "Save a handoff doc to /handoff and start a new focused session",
    handler: async (args, ctx) => {
      // ── Guards ────────────────────────────────────────────
      if (!ctx.hasUI) {
        ctx.ui.notify("handoff requires interactive mode", "error");
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("No model selected — use /model to pick one first", "error");
        return;
      }

      const rawArgs = args?.trim() ?? "";
      const forceReconfigure = rawArgs === "--configure";

      // ── Handle --configure (just update the saved model, nothing else) ──
      if (forceReconfigure) {
        await resolveExtractionModel(ctx, true);
        return;
      }

      // ── Validate goal ─────────────────────────────────────
      const goalError = validateGoal(rawArgs);
      if (goalError) {
        ctx.ui.notify(goalError, "error");
        return;
      }
      const goal = rawArgs;

      // ── Resolve extraction model ──────────────────────────
      const extractionModel = await resolveExtractionModel(ctx, false);
      if (!extractionModel) {
        // User cancelled the picker
        return;
      }

      // ── Gather conversation ───────────────────────────────
      const branch = ctx.sessionManager.getBranch();
      const messages = branch
        .filter((e): e is SessionEntry & { type: "message" } => e.type === "message")
        .map((e) => e.message);

      if (messages.length === 0) {
        ctx.ui.notify("No conversation to hand off yet", "error");
        return;
      }

      const llmMessages = convertToLlm(messages);
      const conversationText = serializeConversation(llmMessages);
      const currentSessionFile = ctx.sessionManager.getSessionFile();
      const sessionName = (ctx.sessionManager as any).getSessionName?.() ?? null;
      const cwd = ctx.sessionManager.getCwd();

      // ── Run LLM extraction with loader ────────────────────
      const extraction = await ctx.ui.custom<
        Awaited<ReturnType<typeof extractContext>> | null
      >((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Extracting context using ${extractionModel.id}…`,
        );
        loader.onAbort = () => done(null);

        extractContext(conversationText, goal, extractionModel, ctx, loader.signal)
          .then((data) => done(data))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            setTimeout(() => ctx.ui.notify(msg, "error"), 50);
            done(null);
          });

        return loader;
      });

      if (extraction === null) {
        return;
      }

      // ── Collect metadata ──────────────────────────────────
      const git = await collectGitInfo(pi);

      const meta = {
        goal,
        timestamp: new Date(),
        model: `${extractionModel.provider}/${extractionModel.id}`,
        git,
        sessionName,
      };

      // ── Build document ────────────────────────────────────
      const doc = buildHandoffDoc(extraction, meta);

      // ── Save to /handoff ──────────────────────────────────
      const handoffDir = join(cwd, "handoff");
      const fileName = buildFileName(goal, meta.timestamp);
      const filePath = join(handoffDir, fileName);
      const relPath = `handoff/${fileName}`;

      try {
        mkdirSync(handoffDir, { recursive: true });
        writeFileSync(filePath, doc, "utf-8");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Failed to save handoff file: ${msg}`, "error");
        return;
      }

      ctx.ui.notify(`Saved → ${relPath}`, "success");

      // ── Editor review ─────────────────────────────────────
      const edited = await ctx.ui.editor("Review handoff prompt", doc);

      if (edited === undefined) {
        ctx.ui.notify(`Handoff cancelled — file already saved to ${relPath}`, "info");
        return;
      }

      // ── Start new session ─────────────────────────────────
      const newSessionResult = await ctx.newSession({
        parentSession: currentSessionFile,
      });

      if (newSessionResult.cancelled) {
        ctx.ui.notify(`New session cancelled — file already saved to ${relPath}`, "info");
        return;
      }

      ctx.ui.setEditorText(edited);
      ctx.ui.notify("Handoff ready — press Enter to send", "success");
    },
  });
}
