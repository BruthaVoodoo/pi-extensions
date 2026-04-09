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

// ─────────────────────────────────────────────────────────────
// Responsive layout
// ─────────────────────────────────────────────────────────────

export interface LayoutResult {
  topContent: string;
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

  if (rendered.length === 0) return { topContent: "", secondaryContent: "" };

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
    topContent: buildLine(topParts, presetName),
    secondaryContent: buildLine(secParts, presetName),
  };
}
