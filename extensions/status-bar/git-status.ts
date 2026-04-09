import { execSync } from "node:child_process";
import type { GitStatus } from "./types.js";

// ─────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────

const CACHE_TTL = 1000;

let cachedStatus: GitStatus = { branch: null, staged: 0, unstaged: 0, untracked: 0 };
let cachedBranch: string | null = null;
let statusTs = 0;
let branchTs = 0;

export function invalidateGitStatus(): void { statusTs = 0; }
export function invalidateGitBranch(): void { branchTs = 0; cachedBranch = null; }

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

function fetchBranch(): string | null {
  const out = run("git rev-parse --abbrev-ref HEAD 2>/dev/null");
  if (!out || out === "HEAD") return null;
  return out;
}

function fetchStatus(branch: string | null): GitStatus {
  const out = run("git status --porcelain 2>/dev/null");
  if (!out && !branch) return { branch: null, staged: 0, unstaged: 0, untracked: 0 };

  let staged = 0, unstaged = 0, untracked = 0;
  for (const line of out.split("\n")) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") { untracked++; continue; }
    if (x && x !== " " && x !== "?") staged++;
    if (y && y !== " " && y !== "?") unstaged++;
  }

  return { branch, staged, unstaged, untracked };
}

// ─────────────────────────────────────────────────────────────
// Public API — called from segment render (sync, cached)
// ─────────────────────────────────────────────────────────────

export function getGitStatus(footerBranch: string | null): GitStatus {
  const now = Date.now();

  // Refresh branch if stale
  if (now - branchTs > CACHE_TTL) {
    cachedBranch = footerBranch ?? fetchBranch();
    branchTs = now;
  }

  // Refresh status if stale
  if (now - statusTs > CACHE_TTL) {
    cachedStatus = fetchStatus(cachedBranch);
    statusTs = now;
  }

  return cachedStatus;
}
