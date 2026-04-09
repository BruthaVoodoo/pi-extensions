import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { getSettingsPath, isRecord, readSettings, writeSettings } from "./config.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ProfileConfig {
  model: string;   // "provider/modelId"
  thinking: ThinkingLevel;
  label?: string;
}

// ─────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────

let profilesCache: ProfileConfig[] = [];

function loadProfilesFromDisk(): ProfileConfig[] {
  const settings = readSettings();
  const raw = settings.modelProfiles;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is ProfileConfig =>
    isRecord(p) &&
    typeof (p as any).model === "string" &&
    typeof (p as any).thinking === "string",
  );
}

export function reloadProfiles(): ProfileConfig[] {
  profilesCache = loadProfilesFromDisk();
  return profilesCache;
}

export function getProfilesCache(): ProfileConfig[] {
  return profilesCache;
}

export function saveProfiles(profiles: ProfileConfig[]): boolean {
  const settings = readSettings();
  settings.modelProfiles = profiles;
  return writeSettings(settings);
}

// ─────────────────────────────────────────────────────────────
// Active profile tracking (in-memory only)
// ─────────────────────────────────────────────────────────────

let activeProfileIndex: number | null = null;

export function getActiveProfileIndex(): number | null { return activeProfileIndex; }
export function setActiveProfileIndex(i: number | null): void { activeProfileIndex = i; }

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

export function parseModelSpec(spec: string): { provider: string; modelId: string } | null {
  const idx = spec.indexOf("/");
  if (idx < 1) return null;
  const provider = spec.slice(0, idx).trim();
  const modelId = spec.slice(idx + 1).trim();
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

export function isThinkingLevel(v: string): v is ThinkingLevel {
  return ["off","minimal","low","medium","high","xhigh"].includes(v);
}

export function findMatchingProfileIndex(
  profiles: ProfileConfig[],
  provider: string,
  modelId: string,
  thinkingLevel: string,
): number | null {
  for (let i = 0; i < profiles.length; i++) {
    const spec = parseModelSpec(profiles[i].model);
    if (
      spec &&
      spec.provider === provider &&
      spec.modelId === modelId &&
      profiles[i].thinking === thinkingLevel
    ) return i;
  }
  return null;
}

export function getProfileDisplayName(profile: ProfileConfig, modelName?: string): string {
  if (profile.label) return profile.label;
  const spec = parseModelSpec(profile.model);
  return modelName || spec?.modelId || profile.model;
}
