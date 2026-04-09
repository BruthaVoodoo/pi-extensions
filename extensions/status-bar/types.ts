import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";

// ─────────────────────────────────────────────────────────────
// Color types
// ─────────────────────────────────────────────────────────────

export type ColorValue = ThemeColor | `#${string}`;

export type SemanticColor =
  | "pi"
  | "model"
  | "path"
  | "gitDirty"
  | "gitClean"
  | "thinking"
  | "context"
  | "contextWarn"
  | "contextError"
  | "cost"
  | "costWarn"
  | "costError"
  | "tokens"
  | "separator"
  | "border"
  | "sessionName";

export type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;

// ─────────────────────────────────────────────────────────────
// Segment types
// ─────────────────────────────────────────────────────────────

export type StatusLineSegmentId =
  | "pi"
  | "model"
  | "path"
  | "git"
  | "thinking"
  | "token_in"
  | "token_out"
  | "token_total"
  | "cost"
  | "context_pct"
  | "context_bar"
  | "context_total"
  | "time_spent"
  | "time"
  | "session"
  | "session_name"
  | "hostname"
  | "cache_read"
  | "cache_write"
  | "extension_statuses";

// ─────────────────────────────────────────────────────────────
// Separator types
// ─────────────────────────────────────────────────────────────

export type StatusLineSeparatorStyle =
  | "powerline"
  | "powerline-thin"
  | "slash"
  | "pipe"
  | "block"
  | "none"
  | "ascii"
  | "dot"
  | "chevron"
  | "star";

// ─────────────────────────────────────────────────────────────
// Preset types
// ─────────────────────────────────────────────────────────────

export type StatusLinePreset =
  | "default"
  | "minimal"
  | "compact"
  | "full"
  | "nerd"
  | "ascii"
  | "focus"
  | "custom"
  | "vertical";

// ─────────────────────────────────────────────────────────────
// Per-segment options
// ─────────────────────────────────────────────────────────────

export interface StatusLineSegmentOptions {
  model?: { showThinkingLevel?: boolean };
  path?: {
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: {
    showBranch?: boolean;
    showStaged?: boolean;
    showUnstaged?: boolean;
    showUntracked?: boolean;
  };
  time?: { format?: "12h" | "24h"; showSeconds?: boolean };
}

// ─────────────────────────────────────────────────────────────
// Row layout
// ─────────────────────────────────────────────────────────────

export interface StatusLineRow {
  /** Segments shown on the left side of the row. */
  left: StatusLineSegmentId[];
  /** Segments shown on the right side of the row, right-aligned. */
  right?: StatusLineSegmentId[];
}

// ─────────────────────────────────────────────────────────────
// Preset definition
// ─────────────────────────────────────────────────────────────

export interface PresetDef {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments?: StatusLineSegmentId[];
  /** Each inner array is one line, rendered top-to-bottom. Used by the vertical preset. */
  rows?: StatusLineRow[];
  /** Number of empty lines to insert between each row in a vertical layout. Default: 0. */
  rowSpacing?: number;
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  colors?: ColorScheme;
}

// ─────────────────────────────────────────────────────────────
// Separator definition
// ─────────────────────────────────────────────────────────────

export interface SeparatorDef {
  left: string;
  right: string;
}

// ─────────────────────────────────────────────────────────────
// Git status
// ─────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

// ─────────────────────────────────────────────────────────────
// Usage statistics
// ─────────────────────────────────────────────────────────────

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// ─────────────────────────────────────────────────────────────
// Segment context — passed to every segment render function
// ─────────────────────────────────────────────────────────────

export interface SegmentContext {
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  activeProfileIndex: number | null;
  activeProfileLabel: string | null;
  sessionId: string | undefined;
  sessionName: string | null;

  usageStats: UsageStats;
  contextPercent: number;
  contextWindow: number;
  autoCompactEnabled: boolean;
  usingSubscription: boolean;
  sessionStartTime: number;

  git: GitStatus;
  extensionStatuses: ReadonlyMap<string, string>;

  options: StatusLineSegmentOptions;
  theme: Theme;
  colors: ColorScheme;
}

// ─────────────────────────────────────────────────────────────
// Rendered output
// ─────────────────────────────────────────────────────────────

export interface RenderedSegment {
  content: string;
  visible: boolean;
}

export interface StatusLineSegment {
  id: StatusLineSegmentId;
  render(ctx: SegmentContext): RenderedSegment;
}
