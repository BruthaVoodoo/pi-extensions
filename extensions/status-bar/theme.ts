import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { ColorScheme, ColorValue, SemanticColor } from "./types.js";

// ─────────────────────────────────────────────────────────────
// Default color scheme
// ─────────────────────────────────────────────────────────────

const DEFAULT_COLORS: Required<ColorScheme> = {
  pi: "accent",
  model: "#d787af",      // Pink / mauve
  path: "#00afaf",       // Teal / cyan
  gitDirty: "warning",
  gitClean: "success",
  thinking: "muted",
  context: "dim",
  contextWarn: "warning",
  contextError: "error",
  cost: "text",
  costWarn: "warning",
  costError: "error",
  tokens: "muted",
  separator: "dim",
  border: "borderMuted",
  sessionName: "#d787af",
};

// Rainbow gradient — used for high/xhigh thinking levels
const RAINBOW: string[] = [
  "#b281d6", "#d787af", "#febc38", "#e4c00f",
  "#89d281", "#00afaf", "#178fb9", "#b281d6",
];

export function getDefaultColors(): Required<ColorScheme> {
  return { ...DEFAULT_COLORS };
}

// ─────────────────────────────────────────────────────────────
// Color resolution
// ─────────────────────────────────────────────────────────────

function isHex(color: ColorValue): color is `#${string}` {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

function hexToAnsi(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const warnedColors = new Set<string>();

export function applyColor(theme: Theme, color: ColorValue, text: string): string {
  if (isHex(color)) return `${hexToAnsi(color)}${text}\x1b[0m`;
  try {
    return theme.fg(color as ThemeColor, text);
  } catch {
    const key = String(color);
    if (!warnedColors.has(key)) {
      warnedColors.add(key);
      console.debug(`[status-bar] Unknown theme color "${key}", using "text"`);
    }
    return theme.fg("text", text);
  }
}

export function fg(
  theme: Theme,
  semantic: SemanticColor,
  text: string,
  presetColors?: ColorScheme,
): string {
  const color = presetColors?.[semantic] ?? DEFAULT_COLORS[semantic];
  return applyColor(theme, color, text);
}

// ─────────────────────────────────────────────────────────────
// Rainbow effect (high / xhigh thinking)
// ─────────────────────────────────────────────────────────────

export function rainbow(text: string): string {
  let result = "";
  let ci = 0;
  for (const char of text) {
    if (char === " " || char === ":") {
      result += char;
    } else {
      result += hexToAnsi(RAINBOW[ci % RAINBOW.length]) + char;
      ci++;
    }
  }
  return result + "\x1b[0m";
}
