/**
 * The message a failed server operation may show to a browser: the first line only (no
 * stack traces, no viem "Request Arguments" dumps), with anything that looks like a secret
 * redacted, and bounded in length. Viem's first line names the failing call or the revert
 * reason, which is what an operator needs to act.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g, // Anthropic keys
  /AIza[0-9A-Za-z_-]{30,}/g, // Google / Gemini API keys
  /\b0x[0-9a-fA-F]{64}\b/g, // private keys (and 32-byte hashes; redacting a hash in an error is harmless)
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /([?&](?:key|apikey|api_key|token)=)[^&\s]+/gi,
];

export function publicError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  let line = raw.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  if (!line) return fallback;
  for (const p of SECRET_PATTERNS) line = line.replace(p, (_m, prefix?: string) => (typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]"));
  return line.length > 240 ? `${line.slice(0, 237)}…` : line;
}
