import { complete, type Message, type Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ExtractionData {
  relevantFiles: Array<{ path: string; reason: string }>;
  relevantCommands: string[];
  relevantInformation: string[];
  decisions: string[];
  openQuestions: string[];
}

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a context extraction assistant. Analyze the conversation and extract structured context for continuing work in a new thread.

Output ONLY a valid JSON object — no markdown fences, no explanation, nothing else:

{
  "relevantFiles": [{ "path": "path/to/file.ts", "reason": "why this file matters" }],
  "relevantCommands": ["npm test", "git status"],
  "relevantInformation": ["key fact or constraint", "important discovery"],
  "decisions": ["decision made and why"],
  "openQuestions": ["unresolved question or risk"]
}

Rules:
- relevantFiles: ONLY files explicitly mentioned in the conversation — never invent paths
- relevantInformation: conventions, gotchas, technical constraints, key findings the next agent needs
- decisions: choices made that affect future work
- openQuestions: blockers, risks, things that are still unclear
- One line per entry, no fluff
- Empty arrays are fine if a category has nothing relevant
- Be GOAL-FOCUSED: extract what helps accomplish the user's stated goal
- Be FUTURE-ORIENTED: what does the next agent need to know?`;

const RETRY_PROMPT = `Your previous response could not be parsed as valid JSON. Output ONLY the JSON object below, filled in with the correct values. No explanation, no markdown, nothing else:

{"relevantFiles":[{"path":"string","reason":"string"}],"relevantCommands":["string"],"relevantInformation":["string"],"decisions":["string"],"openQuestions":["string"]}`;

// ─────────────────────────────────────────────────────────────
// JSON parsing
// ─────────────────────────────────────────────────────────────

function tryParseJson(text: string): unknown | null {
  // Try markdown code block first
  const block = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (block) {
    try { return JSON.parse(block[1].trim()); } catch { /* fall through */ }
  }

  // Try bare JSON object
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch { /* fall through */ }
  }

  // Try the whole text
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Validation — no external schema library needed
// ─────────────────────────────────────────────────────────────

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function toFileArray(v: unknown): Array<{ path: string; reason: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { path: string; reason: string } =>
      x !== null &&
      typeof x === "object" &&
      typeof (x as any).path === "string" &&
      typeof (x as any).reason === "string",
    )
    .map((x) => ({
      path: (x.path as string).replace(/^@/, "").trim(),
      reason: (x.reason as string).trim(),
    }))
    .filter((x) => x.path.length > 0);
}

function validateExtraction(raw: unknown): ExtractionData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  return {
    relevantFiles: toFileArray(r.relevantFiles),
    relevantCommands: toStringArray(r.relevantCommands),
    relevantInformation: toStringArray(r.relevantInformation),
    decisions: toStringArray(r.decisions),
    openQuestions: toStringArray(r.openQuestions),
  };
}

// ─────────────────────────────────────────────────────────────
// File validation — only keep files that appear in the conversation
// ─────────────────────────────────────────────────────────────

function validateFilesAgainstConversation(
  files: Array<{ path: string; reason: string }>,
  conversationText: string,
): Array<{ path: string; reason: string }> {
  const lower = conversationText.toLowerCase();
  return files.filter((f) => {
    const p = f.path.toLowerCase();
    if (lower.includes(p)) return true;
    const name = p.split("/").pop();
    return name ? lower.includes(name) : false;
  });
}

// ─────────────────────────────────────────────────────────────
// LLM call helpers
// ─────────────────────────────────────────────────────────────

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export async function extractContext(
  conversationText: string,
  goal: string,
  model: Model<any>,
  ctx: ExtensionCommandContext,
  signal: AbortSignal,
): Promise<ExtractionData> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(auth.ok ? `No API key for ${ctx.model!.provider}` : (auth as any).error);
  }

  const userMessage: Message = {
    role: "user",
    content: [
      {
        type: "text",
        text: `## Conversation History\n\n${conversationText}\n\n## Goal for New Thread\n\n${goal}`,
      },
    ],
    timestamp: Date.now(),
  };

  // ── First attempt ────────────────────────────────────────
  const response = await complete(
    model,
    { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey: auth.apiKey, headers: auth.headers, signal },
  );

  if (response.stopReason === "aborted") throw new Error("Cancelled");
  if (response.stopReason === "error") throw new Error(response.errorMessage ?? "LLM error");

  const text = extractText(response.content as any);
  const first = validateExtraction(tryParseJson(text));

  if (first) {
    first.relevantFiles = validateFilesAgainstConversation(first.relevantFiles, conversationText);
    return first;
  }

  // ── Retry ────────────────────────────────────────────────
  const assistantMessage: Message = {
    role: "assistant",
    content: response.content as any,
    api: (response as any).api,
    provider: (response as any).provider,
    model: (response as any).model,
    usage: response.usage,
    stopReason: response.stopReason,
    timestamp: response.timestamp,
  };

  const retryUserMessage: Message = {
    role: "user",
    content: [{ type: "text", text: RETRY_PROMPT }],
    timestamp: Date.now(),
  };

  const retryResponse = await complete(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [userMessage, assistantMessage, retryUserMessage],
    },
    { apiKey: auth.apiKey, headers: auth.headers, signal },
  );

  if (retryResponse.stopReason === "aborted") throw new Error("Cancelled");
  if (retryResponse.stopReason === "error") throw new Error(retryResponse.errorMessage ?? "LLM error on retry");

  const retryText = extractText(retryResponse.content as any);
  const second = validateExtraction(tryParseJson(retryText));

  if (second) {
    second.relevantFiles = validateFilesAgainstConversation(second.relevantFiles, conversationText);
    return second;
  }

  throw new Error("Could not parse a valid extraction response after retry. Try again.");
}

// ─────────────────────────────────────────────────────────────
// Git metadata (collected via pi.exec)
// ─────────────────────────────────────────────────────────────

export interface GitInfo {
  branch: string | null;
  isDirty: boolean;
}

export async function collectGitInfo(pi: ExtensionAPI): Promise<GitInfo | null> {
  try {
    const branchResult = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 5000 });
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
    if (branch === "HEAD") {
      // Detached HEAD — still collect dirty state
    }

    const statusResult = await pi.exec("git", ["status", "--porcelain"], { timeout: 5000 });
    const isDirty = statusResult.code === 0 && statusResult.stdout.trim().length > 0;

    return { branch: branch === "HEAD" ? null : branch, isDirty };
  } catch {
    return null;
  }
}
