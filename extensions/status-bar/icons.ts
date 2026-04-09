export interface IconSet {
  pi: string;
  model: string;
  folder: string;
  branch: string;
  git: string;
  tokens: string;
  context: string;
  cost: string;
  time: string;
  cache: string;
  input: string;
  output: string;
  host: string;
  session: string;
  auto: string;
  warning: string;
}

export interface SeparatorChars {
  powerlineLeft: string;
  powerlineRight: string;
  powerlineThinLeft: string;
  powerlineThinRight: string;
  slash: string;
  pipe: string;
  block: string;
  space: string;
  asciiLeft: string;
  asciiRight: string;
  dot: string;
}

export const SEP_DOT = " · ";

// ─────────────────────────────────────────────────────────────
// Thinking level labels
// ─────────────────────────────────────────────────────────────

export const THINKING_UNICODE: Record<string, string> = {
  minimal: "[min]",
  low: "[low]",
  medium: "[med]",
  high: "[high]",
  xhigh: "[xhi]",
};

export const THINKING_NERD: Record<string, string> = {
  minimal: "\u{F0E7} min",
  low: "\u{F10C} low",
  medium: "\u{F192} med",
  high: "\u{F111} high",
  xhigh: "\u{F06D} xhi",
};

export function getThinkingText(level: string): string | undefined {
  return hasNerdFonts() ? THINKING_NERD[level] : THINKING_UNICODE[level];
}

// ─────────────────────────────────────────────────────────────
// Icon sets
// ─────────────────────────────────────────────────────────────

export const NERD_ICONS: IconSet = {
  pi: "\uE22C",
  model: "\uEC19",
  folder: "\uF115",
  branch: "\uF126",
  git: "\uF1D3",
  tokens: "\uE26B",
  context: "\uE70F",
  cost: "\uF155",
  time: "\uF017",
  cache: "\uF1C0",
  input: "\uF090",
  output: "\uF08B",
  host: "\uF109",
  session: "\uF550",
  auto: "\u{F0068}",
  warning: "\uF071",
};

export const ASCII_ICONS: IconSet = {
  pi: "π",
  model: "◈",
  folder: "📁",
  branch: "⎇",
  git: "⎇",
  tokens: "⊛",
  context: "◫",
  cost: "$",
  time: "◷",
  cache: "cache",
  input: "in:",
  output: "out:",
  host: "host",
  session: "id",
  auto: "⚡",
  warning: "⚠",
};

export const NERD_SEPARATORS: SeparatorChars = {
  powerlineLeft: "\uE0B0",
  powerlineRight: "\uE0B2",
  powerlineThinLeft: "\uE0B1",
  powerlineThinRight: "\uE0B3",
  slash: "/",
  pipe: "|",
  block: "█",
  space: " ",
  asciiLeft: ">",
  asciiRight: "<",
  dot: "·",
};

export const ASCII_SEPARATORS: SeparatorChars = {
  powerlineLeft: ">",
  powerlineRight: "<",
  powerlineThinLeft: "|",
  powerlineThinRight: "|",
  slash: "/",
  pipe: "|",
  block: "#",
  space: " ",
  asciiLeft: ">",
  asciiRight: "<",
  dot: ".",
};

// ─────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────

export function hasNerdFonts(): boolean {
  if (process.env.STATUSBAR_NERD_FONTS === "1") return true;
  if (process.env.STATUSBAR_NERD_FONTS === "0") return false;
  if (process.env.GHOSTTY_RESOURCES_DIR) return true;
  const term = (process.env.TERM_PROGRAM || "").toLowerCase();
  return ["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((t) => term.includes(t));
}

export function getIcons(): IconSet {
  return hasNerdFonts() ? NERD_ICONS : ASCII_ICONS;
}

export function getSeparatorChars(): SeparatorChars {
  return hasNerdFonts() ? NERD_SEPARATORS : ASCII_SEPARATORS;
}
