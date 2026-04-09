import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ExtractionModelConfig {
  provider: string;
  id: string;
}

// ─────────────────────────────────────────────────────────────
// Settings file helpers
// ─────────────────────────────────────────────────────────────

function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function readSettings(): Record<string, unknown> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Load the saved extraction model config from ~/.pi/agent/settings.json.
 * Returns null if not set or invalid.
 */
export function loadExtractionModelConfig(): ExtractionModelConfig | null {
  const settings = readSettings();
  const cfg = (settings?.sessionHandoff as any)?.extractionModel;
  if (
    cfg &&
    typeof cfg === "object" &&
    typeof cfg.provider === "string" &&
    typeof cfg.id === "string" &&
    cfg.provider.length > 0 &&
    cfg.id.length > 0
  ) {
    return { provider: cfg.provider, id: cfg.id };
  }
  return null;
}

/**
 * Save the extraction model config to ~/.pi/agent/settings.json.
 */
export function saveExtractionModelConfig(model: ExtractionModelConfig): void {
  const settings = readSettings();
  if (!settings.sessionHandoff || typeof settings.sessionHandoff !== "object") {
    settings.sessionHandoff = {};
  }
  (settings.sessionHandoff as Record<string, unknown>).extractionModel = {
    provider: model.provider,
    id: model.id,
  };
  writeSettings(settings);
}

/**
 * Clear the saved extraction model config.
 */
export function clearExtractionModelConfig(): void {
  const settings = readSettings();
  if (settings.sessionHandoff && typeof settings.sessionHandoff === "object") {
    delete (settings.sessionHandoff as Record<string, unknown>).extractionModel;
    if (Object.keys(settings.sessionHandoff as object).length === 0) {
      delete settings.sessionHandoff;
    }
  }
  writeSettings(settings);
}
