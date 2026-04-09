import { visibleWidth } from "@mariozechner/pi-tui";
import type { SegmentContext, StatusLineSegmentId } from "./types.js";
import { renderSegment } from "./segments.js";
import { getSeparator } from "./separators.js";
import { getFgAnsiCode, ansi } from "./colors.js";
import { getPreset } from "./presets.js";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function truncateByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  const target = maxWidth - 1;
  let out = "";
  let w = 0;
  for (const char of text) {
    const cw = visibleWidth(char);
    if (w + cw > target) break;
    out += char;
    w += cw;
  }
  return out.trimEnd() + "…";
}

function buildLine(parts: string[], presetName: string): string {
  if (parts.length === 0) return "";
  const preset = getPreset(presetName as any);
  const sep = getSeparator(preset.separator);
  const sepAnsi = getFgAnsiCode("sep");
  return " " + parts.join(` ${sepAnsi}${sep.left}${ansi.reset} `) + ansi.reset + " ";
}

// Like buildLine but without a leading space, so the caller can position it.
function buildRightContent(parts: string[], presetName: string): string {
  if (parts.length === 0) return "";
  const preset = getPreset(presetName as any);
  const sep = getSeparator(preset.separator);
  const sepAnsi = getFgAnsiCode("sep");
  return parts.join(` ${sepAnsi}${sep.left}${ansi.reset} `) + ansi.reset + " ";
}

// ─────────────────────────────────────────────────────────────
// Responsive layout
// ─────────────────────────────────────────────────────────────

export interface LayoutResult {
  topLines: string[];
  secondaryContent: string;
}

export function computeLayout(
  ctx: SegmentContext,
  presetName: string,
  availableWidth: number,
): LayoutResult {
  const preset = getPreset(presetName as any);
  const sep = getSeparator(preset.separator);
  const sepWidth = visibleWidth(sep.left) + 2;

  // Vertical layout: each row is its own line, with optional right-aligned content
  if (preset.rows) {
    const spacing = preset.rowSpacing ?? 0;
    const topLines: string[] = [];

    for (const row of preset.rows) {
      const leftParts: string[] = [];
      for (const id of row.left ?? []) {
        const r = renderSegment(id, ctx);
        if (r.visible && r.content) leftParts.push(r.content);
      }

      const rightParts: string[] = [];
      for (const id of row.right ?? []) {
        const r = renderSegment(id, ctx);
        if (r.visible && r.content) rightParts.push(r.content);
      }

      if (leftParts.length === 0 && rightParts.length === 0) continue;

      if (topLines.length > 0) {
        for (let i = 0; i < spacing; i++) topLines.push("");
      }

      if (rightParts.length === 0) {
        // Left only
        topLines.push(buildLine(leftParts, presetName));
      } else if (leftParts.length === 0) {
        // Right only — right-align
        const rightStr = buildRightContent(rightParts, presetName);
        const pad = Math.max(0, availableWidth - visibleWidth(rightStr));
        topLines.push(" ".repeat(pad) + rightStr);
      } else {
        // Left + right — pad between them
        const leftStr = buildLine(leftParts, presetName);
        const rightStr = buildRightContent(rightParts, presetName);
        const pad = Math.max(0, availableWidth - visibleWidth(leftStr) - visibleWidth(rightStr));
        topLines.push(leftStr + " ".repeat(pad) + rightStr);
      }
    }

    return { topLines, secondaryContent: "" };
  }

  const allIds: StatusLineSegmentId[] = [
    ...preset.leftSegments,
    ...preset.rightSegments,
    ...(preset.secondarySegments ?? []),
  ];

  // Render all visible segments
  const rendered: { content: string; width: number }[] = [];
  for (const id of allIds) {
    const r = renderSegment(id, ctx);
    if (r.visible && r.content) {
      rendered.push({ content: r.content, width: visibleWidth(r.content) });
    }
  }

  if (rendered.length === 0) return { topLines: [], secondaryContent: "" };

  // Fit as many segments as possible into the top row
  const overhead = 2; // leading + trailing space
  let usedWidth = overhead;
  const topParts: string[] = [];
  const overflow: { content: string; width: number }[] = [];
  let spilled = false;

  for (const seg of rendered) {
    const needed = seg.width + (topParts.length > 0 ? sepWidth : 0);
    if (!spilled && usedWidth + needed <= availableWidth) {
      topParts.push(seg.content);
      usedWidth += needed;
    } else {
      spilled = true;
      overflow.push(seg);
    }
  }

  // Fit overflow into secondary row
  let secWidth = overhead;
  const secParts: string[] = [];
  for (const seg of overflow) {
    const needed = seg.width + (secParts.length > 0 ? sepWidth : 0);
    if (secWidth + needed <= availableWidth) {
      secParts.push(seg.content);
      secWidth += needed;
    } else {
      break;
    }
  }

  return {
    topLines: [buildLine(topParts, presetName)],
    secondaryContent: buildLine(secParts, presetName),
  };
}
