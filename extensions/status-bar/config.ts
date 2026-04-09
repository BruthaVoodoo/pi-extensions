import {
  existsSync, readFileSync, writeFileSync,
  mkdirSync, readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { StatusLinePreset } from "./types.js";
import { PRESETS } from "./presets.js";

// ─────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function getSettingsPath(): string {
  return join(homeDir(), ".pi", "agent", "settings.json");
}

export function getStashHistoryPath(): string {
  return join(homeDir(), ".pi", "agent", "status-bar", "stash-history.json");
}

export function getSessionsPath(): string {
  return join(homeDir(), ".pi", "agent", "sessions");
}

// ─────────────────────────────────────────────────────────────
// Generic settings helpers
// ─────────────────────────────────────────────────────────────

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readSettings(): Record<string, unknown> {
  const path = getSettingsPath();
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSettings(settings: Record<string, unknown>): boolean {
  const path = getSettingsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    return true;
  } catch (err) {
    console.debug("[status-bar] Failed to write settings:", err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Preset persistence
// ─────────────────────────────────────────────────────────────

export function isValidPreset(value: unknown): value is StatusLinePreset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

export function normalizePreset(value: unknown): StatusLinePreset | null {
  if (typeof value !== "string") return null;
  const p = value.trim().toLowerCase();
  return isValidPreset(p) ? p : null;
}

export function savePreset(preset: StatusLinePreset): boolean {
  const settings = readSettings();
  settings.statusBar = preset;
  return writeSettings(settings);
}

// ─────────────────────────────────────────────────────────────
// Stash history persistence
// ─────────────────────────────────────────────────────────────

const STASH_LIMIT = 12;

export function readStashHistory(): string[] {
  const path = getStashHistoryPath();
  try {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed)) return [];
    return normalizeStringArray(parsed.history, STASH_LIMIT);
  } catch {
    return [];
  }
}

export function writeStashHistory(history: string[]): void {
  const path = getStashHistoryPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, history: history.slice(0, STASH_LIMIT) }, null, 2) + "\n");
  } catch (err) {
    console.debug("[status-bar] Failed to write stash history:", err);
  }
}

function normalizeStringArray(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    if (out[out.length - 1] === entry) continue;
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Project prompt history (from session files)
// ─────────────────────────────────────────────────────────────

const PROJECT_PROMPT_LIMIT = 50;

function getProjectSessionsPath(cwd: string): string {
  const key = cwd.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "-");
  return join(getSessionsPath(), `--${key}--`);
}

function getPromptText(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => isRecord(b) && b.type === "text" && typeof b.text === "string")
    .map((b) => (b as any).text)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function readProjectPrompts(cwd: string): string[] {
  const dir = getProjectSessionsPath(cwd);
  if (!existsSync(dir)) return [];

  const entries: { text: string; ts: number }[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const lines = readFileSync(join(dir, file), "utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"role":"user"')) continue;
      try {
        const entry = JSON.parse(line);
        if (!isRecord(entry) || entry.type !== "message") continue;
        const msg = entry.message;
        if (!isRecord(msg) || msg.role !== "user") continue;
        const text = getPromptText(msg.content);
        if (!text) continue;
        const ts = typeof msg.timestamp === "number" ? msg.timestamp : 0;
        entries.push({ text, ts });
      } catch { /* skip malformed lines */ }
    }
  }

  entries.sort((a, b) => b.ts - a.ts);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const { text } of entries) {
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= PROJECT_PROMPT_LIMIT) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Shortcut config
// ─────────────────────────────────────────────────────────────

export interface StatusBarShortcuts {
  stashHistory: string;
  copyEditor: string;
  cutEditor: string;
  profileCycle: string;
  profileSelect: string;
}

const DEFAULT_SHORTCUTS: StatusBarShortcuts = {
  stashHistory: "ctrl+alt+h",
  copyEditor: "ctrl+alt+c",
  cutEditor: "ctrl+alt+x",
  profileCycle: "alt+shift+tab",
  profileSelect: "ctrl+alt+m",
};

const RESERVED = new Set(["alt+s"]);
const MODIFIERS = new Set(["ctrl", "alt", "shift"]);
const NAMED_KEYS = new Set([
  "escape","esc","enter","return","tab","space","backspace","delete",
  "home","end","pageup","pagedown","up","down","left","right",
]);
const SYMBOL_KEYS = new Set([
  "`","-","=","[","]","\\",";","'",",",".","/",
  "!","@","#","$","%","^","&","*","(",")",
]);

type ShortcutKey = keyof StatusBarShortcuts;
const ALL_KEYS: ShortcutKey[] = ["stashHistory","copyEditor","cutEditor","profileCycle","profileSelect"];

function parseShortcut(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const parts = trimmed.split("+");
  if (parts.some((p) => p.length === 0)) return null;
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  if (new Set(mods).size !== mods.length) return null;
  for (const m of mods) if (!MODIFIERS.has(m)) return null;
  const key = parts[parts.length - 1];
  const isValid = /^[a-z0-9]$/i.test(key) || /^f([1-9]|1[0-2])$/i.test(key) ||
    NAMED_KEYS.has(key.toLowerCase()) || SYMBOL_KEYS.has(key);
  if (!isValid) return null;
  const normalKey = SYMBOL_KEYS.has(key) ? key : key.toLowerCase();
  return [...mods, normalKey].join("+");
}

export function resolveShortcuts(settings: Record<string, unknown>): StatusBarShortcuts {
  const resolved: StatusBarShortcuts = { ...DEFAULT_SHORTCUTS };
  const overrides = settings.statusBarShortcuts;
  if (isRecord(overrides)) {
    for (const key of ALL_KEYS) {
      const parsed = parseShortcut(overrides[key]);
      if (parsed) resolved[key] = parsed;
    }
  }

  // Dedup: remove conflicts with reserved + earlier entries
  const used = new Set<string>([...RESERVED]);
  for (const key of ALL_KEYS) {
    const norm = resolved[key].toLowerCase();
    if (!used.has(norm)) { used.add(norm); continue; }
    // Find a free default
    const fallback = ALL_KEYS.map((k) => DEFAULT_SHORTCUTS[k]).find((s) => !used.has(s.toLowerCase()));
    if (fallback) { resolved[key] = fallback; used.add(fallback.toLowerCase()); }
  }

  return resolved;
}
