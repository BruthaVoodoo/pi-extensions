// ANSI escape helpers

export const ansi = {
  getBgAnsi: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
  getFgAnsi: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  getFgAnsi256: (code: number) => `\x1b[38;5;${code}m`,
  reset: "\x1b[0m",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Colors used for chrome rendering (editor borders, separators, welcome box)
const CHROME = {
  sep: 244,          // ANSI-256 gray
  model: "#d787af",  // Pink / mauve
  path: "#00afaf",   // Teal / cyan
  gitClean: "#5faf5f",
  accent: "#febc38", // Orange
} as const;

type ChromeColor = keyof typeof CHROME;

function getChromeAnsi(color: ChromeColor): string {
  const v = CHROME[color];
  if (typeof v === "number") return ansi.getFgAnsi256(v);
  const [r, g, b] = hexToRgb(v);
  return ansi.getFgAnsi(r, g, b);
}

export function fgOnly(color: ChromeColor, text: string): string {
  return `${getChromeAnsi(color)}${text}`;
}

export function getFgAnsiCode(color: ChromeColor): string {
  return getChromeAnsi(color);
}
