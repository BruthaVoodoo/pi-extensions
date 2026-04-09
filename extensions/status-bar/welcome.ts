import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir as osHomedir } from "node:os";
import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ansi, fgOnly, getFgAnsiCode } from "./colors.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RecentSession {
  name: string;
  timeAgo: string;
}

export interface LoadedCounts {
  contextFiles: number;
  extensions: number;
  skills: number;
  promptTemplates: number;
}

// ─────────────────────────────────────────────────────────────
// Rendering utilities
// ─────────────────────────────────────────────────────────────

const PI_LOGO = [
  "▀████████████▀",
  " ╘███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

const GRADIENT = [
  "\x1b[38;5;199m",
  "\x1b[38;5;171m",
  "\x1b[38;5;135m",
  "\x1b[38;5;99m",
  "\x1b[38;5;75m",
  "\x1b[38;5;51m",
];

function bold(text: string): string { return `\x1b[1m${text}\x1b[22m`; }
function dim(text: string): string { return getFgAnsiCode("sep") + text + ansi.reset; }
function check(): string { return fgOnly("gitClean", "✓"); }

function gradientLine(line: string): string {
  let result = "";
  let ci = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT.length));
  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && ci < GRADIENT.length - 1) ci++;
    const char = line[i];
    result += char !== " " ? GRADIENT[ci] + char + ansi.reset : char;
  }
  return result;
}

function centerIn(text: string, width: number): string {
  const vlen = visibleWidth(text);
  if (vlen >= width) return text;
  const left = Math.floor((width - vlen) / 2);
  return " ".repeat(left) + text + " ".repeat(width - vlen - left);
}

function fitIn(text: string, width: number): string {
  const vlen = visibleWidth(text);
  if (vlen > width) return truncateVis(text, width);
  return text + " ".repeat(width - vlen);
}

function truncateVis(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let w = 0;
  let inEsc = false;
  for (const ch of text) {
    if (ch === "\x1b") { inEsc = true; }
    if (inEsc) { out += ch; if (ch === "m") inEsc = false; continue; }
    const cw = visibleWidth(ch);
    if (w + cw > width - 1) break;
    out += ch; w += cw;
  }
  return visibleWidth(text) > width ? out + "…" : out;
}

// ─────────────────────────────────────────────────────────────
// Column builders
// ─────────────────────────────────────────────────────────────

function leftColumn(data: { modelName: string; providerName: string }, w: number): string[] {
  return [
    "",
    centerIn(bold("Welcome back!"), w),
    "",
    ...PI_LOGO.map((l) => centerIn(gradientLine(l), w)),
    "",
    centerIn(fgOnly("model", data.modelName), w),
    centerIn(dim(data.providerName), w),
  ];
}

function rightColumn(
  data: { recentSessions: RecentSession[]; loadedCounts: LoadedCounts },
  w: number,
): string[] {
  const hr = ` ${dim("─".repeat(w - 2))}`;
  const { contextFiles, extensions, skills, promptTemplates } = data.loadedCounts;

  const countLines: string[] = [];
  if (contextFiles > 0) countLines.push(` ${check()} ${fgOnly("gitClean", String(contextFiles))} context file${contextFiles !== 1 ? "s" : ""}`);
  if (extensions > 0)   countLines.push(` ${check()} ${fgOnly("gitClean", String(extensions))} extension${extensions !== 1 ? "s" : ""}`);
  if (skills > 0)       countLines.push(` ${check()} ${fgOnly("gitClean", String(skills))} skill${skills !== 1 ? "s" : ""}`);
  if (promptTemplates > 0) countLines.push(` ${check()} ${fgOnly("gitClean", String(promptTemplates))} template${promptTemplates !== 1 ? "s" : ""}`);
  if (countLines.length === 0) countLines.push(` ${dim("Nothing loaded")}`);

  const sessionLines: string[] =
    data.recentSessions.length === 0
      ? [` ${dim("No recent sessions")}`]
      : data.recentSessions.slice(0, 3).map(
          (s) => ` ${dim("• ")}${fgOnly("path", s.name)}${dim(` (${s.timeAgo})`)}`,
        );

  return [
    ` ${bold(fgOnly("accent", "Tips"))}`,
    ` ${dim("/")} for commands`,
    ` ${dim("!")} to run bash`,
    ` ${dim("Shift+Tab")} cycle thinking`,
    hr,
    ` ${bold(fgOnly("accent", "Loaded"))}`,
    ...countLines,
    hr,
    ` ${bold(fgOnly("accent", "Recent sessions"))}`,
    ...sessionLines,
    "",
  ];
}

// ─────────────────────────────────────────────────────────────
// Box renderer
// ─────────────────────────────────────────────────────────────

function renderBox(
  data: Parameters<typeof leftColumn>[0] & Parameters<typeof rightColumn>[0],
  termWidth: number,
  bottomLine: string,
): string[] {
  const MIN = 44;
  if (termWidth < MIN) return [];

  const boxWidth = Math.min(termWidth, Math.max(76, Math.min(termWidth - 2, 96)));
  const LEFT_W = 26;
  const RIGHT_W = Math.max(1, boxWidth - LEFT_W - 3);

  const hChar = "─";
  const v   = dim("│");
  const tl  = dim("╭");
  const tr  = dim("╮");
  const bl  = dim("╰");
  const br  = dim("╯");

  const leftLines  = leftColumn(data, LEFT_W);
  const rightLines = rightColumn(data, RIGHT_W);

  const lines: string[] = [];

  // Top border with title
  const title = " pi agent ";
  const prefix = dim("─".repeat(3));
  const titleStyled = prefix + fgOnly("model", title);
  const titleLen = 3 + visibleWidth(title);
  const after = boxWidth - 2 - titleLen;
  lines.push(tl + titleStyled + (after > 0 ? dim("─".repeat(after)) : "") + tr);

  const rows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < rows; i++) {
    const l = fitIn(leftLines[i] ?? "", LEFT_W);
    const r = fitIn(rightLines[i] ?? "", RIGHT_W);
    lines.push(v + l + v + r + v);
  }

  lines.push(bl + bottomLine + br);
  return lines;
}

// ─────────────────────────────────────────────────────────────
// Welcome overlay component (dismisses on any keypress)
// ─────────────────────────────────────────────────────────────

export class WelcomeOverlay implements Component {
  private data: Parameters<typeof renderBox>[0];

  constructor(
    modelName: string,
    providerName: string,
    recentSessions: RecentSession[] = [],
    loadedCounts: LoadedCounts = { contextFiles: 0, extensions: 0, skills: 0, promptTemplates: 0 },
  ) {
    this.data = { modelName, providerName, recentSessions, loadedCounts };
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    if (termWidth < 44) return [];
    const boxWidth = Math.min(termWidth, Math.max(76, Math.min(termWidth - 2, 96)));
    const bottomText = " Press any key to dismiss ";
    const bw = boxWidth - 2;
    const blen = visibleWidth(bottomText);
    const lpad = Math.floor((bw - blen) / 2);
    const rpad = bw - blen - lpad;
    const bottomLine =
      dim("─".repeat(Math.max(0, lpad))) +
      dim(bottomText) +
      dim("─".repeat(Math.max(0, rpad)));

    return renderBox(this.data, termWidth, bottomLine);
  }
}

// ─────────────────────────────────────────────────────────────
// Discovery helpers
// ─────────────────────────────────────────────────────────────

const loggedErrors = new Set<string>();
function logErr(scope: string, err: unknown): void {
  const key = `${scope}:${err instanceof Error ? err.message : String(err)}`;
  if (loggedErrors.has(key)) return;
  loggedErrors.add(key);
  console.debug(`[status-bar/welcome] ${scope}:`, err);
}

export function discoverLoadedCounts(): LoadedCounts {
  const home = process.env.HOME || process.env.USERPROFILE || osHomedir();
  const cwd  = process.cwd();
  let contextFiles = 0, extensions = 0, skills = 0, promptTemplates = 0;

  // Context files (AGENTS.md)
  for (const p of [
    join(home, ".pi", "agent", "AGENTS.md"),
    join(home, ".claude", "AGENTS.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".pi", "AGENTS.md"),
  ]) { if (existsSync(p)) contextFiles++; }

  // Extensions
  const counted = new Set<string>();
  for (const dir of [
    join(home, ".pi", "agent", "extensions"),
    join(cwd, ".pi", "extensions"),
  ]) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (counted.has(entry)) continue;
        const ep = join(dir, entry);
        try {
          const s = statSync(ep);
          if (
            s.isDirectory() &&
            (existsSync(join(ep, "index.ts")) || existsSync(join(ep, "package.json")))
          ) { counted.add(entry); extensions++; }
        } catch (e) { logErr(`stat ${ep}`, e); }
      }
    } catch (e) { logErr(`readdir ${dir}`, e); }
  }

  // Skills
  const countedSkills = new Set<string>();
  for (const dir of [join(home, ".pi", "agent", "skills"), join(cwd, ".pi", "skills")]) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (countedSkills.has(entry)) continue;
        const ep = join(dir, entry);
        try {
          if (statSync(ep).isDirectory() && existsSync(join(ep, "SKILL.md"))) {
            countedSkills.add(entry); skills++;
          }
        } catch (e) { logErr(`stat ${ep}`, e); }
      }
    } catch (e) { logErr(`readdir ${dir}`, e); }
  }

  // Prompt templates
  const countedTpl = new Set<string>();
  function scanTemplates(dir: string) {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const ep = join(dir, entry);
        try {
          if (statSync(ep).isDirectory()) { scanTemplates(ep); continue; }
          if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTpl.has(name)) { countedTpl.add(name); promptTemplates++; }
          }
        } catch (e) { logErr(`stat ${ep}`, e); }
      }
    } catch (e) { logErr(`readdir ${dir}`, e); }
  }
  for (const dir of [
    join(home, ".pi", "agent", "commands"),
    join(home, ".claude", "commands"),
    join(cwd, ".pi", "commands"),
  ]) { scanTemplates(dir); }

  return { contextFiles, extensions, skills, promptTemplates };
}

export function getRecentSessions(max = 3): RecentSession[] {
  const home = process.env.HOME || process.env.USERPROFILE || osHomedir();
  const dirs = [join(home, ".pi", "agent", "sessions"), join(home, ".pi", "sessions")];
  const sessions: { name: string; mtime: number }[] = [];

  function scan(dir: string) {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const ep = join(dir, entry);
        try {
          const s = statSync(ep);
          if (s.isDirectory()) { scan(ep); continue; }
          if (entry.endsWith(".jsonl")) {
            const parent = basename(dir);
            let name = parent;
            if (parent.startsWith("--")) {
              const parts = parent.split("-").filter(Boolean);
              name = parts[parts.length - 1] || parent;
            }
            sessions.push({ name, mtime: s.mtimeMs });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  for (const d of dirs) scan(d);
  sessions.sort((a, b) => b.mtime - a.mtime);

  const seen = new Set<string>();
  const unique = sessions.filter((s) => !seen.has(s.name) && seen.add(s.name));
  const now = Date.now();

  return unique.slice(0, max).map((s) => ({
    name: s.name.length > 20 ? s.name.slice(0, 17) + "…" : s.name,
    timeAgo: formatAgo(now - s.mtime),
  }));
}

function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}
