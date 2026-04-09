import type { ExtractionData, GitInfo } from "./extraction.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface HandoffMeta {
  goal: string;
  timestamp: Date;
  model?: string;
  git?: GitInfo | null;
  sessionName?: string | null;
}

// ─────────────────────────────────────────────────────────────
// File naming
// ─────────────────────────────────────────────────────────────

/**
 * Builds a descriptive, sortable filename from the goal and timestamp.
 * Example: 2026-04-09T14-30-00-implement-auth-for-teams.md
 */
export function buildFileName(goal: string, timestamp: Date): string {
  const datePart = timestamp
    .toISOString()
    .slice(0, 19)       // "2026-04-09T14:30:00"
    .replace(/:/g, "-"); // "2026-04-09T14-30-00"

  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48)
    .replace(/-+$/, "");

  return `${datePart}-${slug}.md`;
}

// ─────────────────────────────────────────────────────────────
// Document assembly
// ─────────────────────────────────────────────────────────────

/**
 * Builds the full handoff markdown document.
 * This is what gets saved to disk and pre-filled in the editor.
 */
export function buildHandoffDoc(data: ExtractionData, meta: HandoffMeta): string {
  const lines: string[] = [];

  // ── Title ────────────────────────────────────────────────
  lines.push(`# Handoff: ${meta.goal}`);
  lines.push("");

  // ── Metadata block ───────────────────────────────────────
  lines.push(`> **Generated:** ${meta.timestamp.toISOString()}`);
  if (meta.model) {
    lines.push(`> **Model:** ${meta.model}`);
  }
  if (meta.git?.branch) {
    const dirty = meta.git.isDirty ? " *(uncommitted changes)*" : "";
    lines.push(`> **Branch:** \`${meta.git.branch}\`${dirty}`);
  }
  if (meta.sessionName) {
    lines.push(`> **Session:** ${meta.sessionName}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Preamble for the model ───────────────────────────────
  lines.push(
    "You are continuing work from a previous session. " +
    "Use the context below to accomplish the goal at the end. " +
    "Do not mention the handoff itself.",
  );
  lines.push("");

  // ── Key Context ──────────────────────────────────────────
  if (data.relevantInformation.length > 0) {
    lines.push("## Key Context");
    for (const item of data.relevantInformation) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  // ── Decisions Made ───────────────────────────────────────
  if (data.decisions.length > 0) {
    lines.push("## Decisions Made");
    for (const d of data.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push("");
  }

  // ── Open Questions & Risks ───────────────────────────────
  if (data.openQuestions.length > 0) {
    lines.push("## Open Questions & Risks");
    for (const q of data.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  // ── Relevant Files ───────────────────────────────────────
  if (data.relevantFiles.length > 0) {
    lines.push("## Relevant Files");
    for (const f of data.relevantFiles) {
      lines.push(`- \`${f.path}\` — ${f.reason}`);
    }
    lines.push("");
  }

  // ── Commands to Know ─────────────────────────────────────
  if (data.relevantCommands.length > 0) {
    lines.push("## Commands");
    for (const c of data.relevantCommands) {
      lines.push(`- \`${c}\``);
    }
    lines.push("");
  }

  // ── Goal (always last) ───────────────────────────────────
  lines.push("## Goal");
  lines.push(meta.goal);
  lines.push("");

  return lines.join("\n");
}
