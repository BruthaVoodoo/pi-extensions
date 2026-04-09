/**
 * Session Handoff Extension
 *
 * Extracts structured context from the current session using the active model,
 * saves a markdown document to /handoff in the project root, then opens a new
 * session with the document pre-filled in the editor.
 *
 * Usage:
 *   /handoff implement auth for teams
 *   /handoff fix the race condition in the event loop
 *   /handoff add unit tests for the parser module
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

import { extractContext, collectGitInfo } from "./extraction.js";
import { buildHandoffDoc, buildFileName } from "./prompt.js";

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

      const goal = args?.trim() ?? "";
      const goalError = validateGoal(goal);
      if (goalError) {
        ctx.ui.notify(goalError, "error");
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
      const sessionName = ctx.sessionManager.getSessionName?.() ?? null;
      const cwd = ctx.sessionManager.getCwd();

      // ── Run LLM extraction with loader ────────────────────
      const extraction = await ctx.ui.custom<
        Awaited<ReturnType<typeof extractContext>> | null
      >((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Extracting context using ${ctx.model!.id}…`,
        );
        loader.onAbort = () => done(null);

        extractContext(conversationText, goal, ctx, loader.signal)
          .then((data) => done(data))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            // Surface errors after the loader closes
            setTimeout(() => ctx.ui.notify(msg, "error"), 50);
            done(null);
          });

        return loader;
      });

      if (extraction === null) {
        // Either cancelled or error already notified above
        return;
      }

      // ── Collect metadata ──────────────────────────────────
      const git = await collectGitInfo(pi);

      const meta = {
        goal,
        timestamp: new Date(),
        model: `${ctx.model.provider}/${ctx.model.id}`,
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
        ctx.ui.notify("Handoff cancelled — file already saved to " + relPath, "info");
        return;
      }

      // ── Start new session ─────────────────────────────────
      const newSessionResult = await ctx.newSession({
        parentSession: currentSessionFile,
      });

      if (newSessionResult.cancelled) {
        ctx.ui.notify("New session cancelled — file already saved to " + relPath, "info");
        return;
      }

      ctx.ui.setEditorText(edited);
      ctx.ui.notify("Handoff ready — press Enter to send", "success");
    },
  });
}
