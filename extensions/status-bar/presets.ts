import type { ColorScheme, PresetDef, StatusLinePreset } from "./types.js";
import { getDefaultColors } from "./theme.js";

const DEFAULTS = getDefaultColors();

const MINIMAL_COLORS: ColorScheme = {
  ...DEFAULTS,
  pi: "dim",
  model: "text",
  path: "text",
  gitClean: "dim",
};

const NERD_COLORS: ColorScheme = {
  ...DEFAULTS,
  pi: "accent",
  model: "accent",
  path: "success",
  tokens: "muted",
  cost: "warning",
};

export const PRESETS: Record<StatusLinePreset, PresetDef> = {
  // Default — balanced everyday view with visual context bar
  default: {
    leftSegments: ["pi", "model", "path", "git", "context_bar", "cost"],
    rightSegments: [],
    secondarySegments: ["extension_statuses"],
    separator: "powerline-thin",
    colors: DEFAULTS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  // Minimal — path, git, and context only
  minimal: {
    leftSegments: ["path", "git"],
    rightSegments: ["context_bar"],
    separator: "slash",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
    },
  },

  // Compact — model + git on left, cost + context on right
  compact: {
    leftSegments: ["model", "git"],
    rightSegments: ["cost", "context_bar"],
    separator: "powerline-thin",
    colors: DEFAULTS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
    },
  },

  // Focus — just what matters: git and context bar, zero noise
  focus: {
    leftSegments: ["git"],
    rightSegments: ["context_bar"],
    separator: "dot",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
    },
  },

  // Full — everything including hostname, session name, time
  full: {
    leftSegments: ["pi", "hostname", "model", "thinking", "session_name", "path", "git"],
    rightSegments: ["token_in", "token_out", "cache_read", "cost", "context_bar", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    colors: DEFAULTS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 50 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: false },
    },
  },

  // Nerd — maximum detail for Nerd Font users
  nerd: {
    leftSegments: ["pi", "hostname", "model", "thinking", "session_name", "path", "git", "session"],
    rightSegments: ["token_in", "token_out", "cache_read", "cache_write", "cost", "context_bar", "context_total", "time_spent", "time", "extension_statuses"],
    separator: "powerline",
    colors: NERD_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 60 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: true },
    },
  },

  // ASCII — safe for any terminal
  ascii: {
    leftSegments: ["model", "path", "git"],
    rightSegments: ["token_total", "cost", "context_pct"],
    separator: "ascii",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: true },
      path: { mode: "abbreviated", maxLength: 40 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  // Custom — user-defined (safe starting point)
  custom: {
    leftSegments: ["model", "path", "git"],
    rightSegments: ["cost", "context_bar"],
    separator: "powerline-thin",
    colors: DEFAULTS,
    segmentOptions: {},
  },
};

export function getPreset(name: StatusLinePreset): PresetDef {
  return PRESETS[name] ?? PRESETS.default;
}
