// ─────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "0";
  const num = Number(n);
  if (!isFinite(num)) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return Math.round(num / 1_000) + "k";
  return Math.round(num).toString();
}

export function getUsageColor(pct: number): "success" | "warning" | "error" {
  if (pct >= 0.9) return "error";
  if (pct >= 0.7) return "warning";
  return "success";
}

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
