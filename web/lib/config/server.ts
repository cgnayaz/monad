import "server-only";
import { z } from "zod";

/**
 * Server-only configuration. Secrets are read lazily so that pages which do not need
 * them still build and render; a missing secret surfaces as an explicit
 * "unavailable" state rather than a crash or a placeholder.
 */

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x-prefixed 32-byte hex");

const ServerEnv = z.object({
  /** Which provider runs the agents. Default: gemini (anthropic only if ANTHROPIC_API_KEY is the only key set). */
  AI_PROVIDER: z.enum(["gemini", "anthropic"]).optional(),
  /** Gemini key; GOOGLE_API_KEY (the SDK's own variable name) is accepted as an alias. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Model id; default depends on the provider (see lib/ai/index.ts). */
  AI_MODEL: z.string().min(1).optional(),
  /** Gemini only: comma-separated models tried when the primary is overloaded or out of quota. */
  AI_FALLBACK_MODEL: z.string().min(1).optional(),
  PYTH_HERMES_URL: z.string().url().default("https://pyth.dourolabs.app/hermes"),
  PYTH_API_KEY: z.string().min(1).optional(),
  PROPOSER_PRIVATE_KEY: privateKey.optional(),
  KEEPER_PRIVATE_KEY: privateKey.optional(),
  AGENT_RISK_PRIVATE_KEY: privateKey.optional(),
  AGENT_YIELD_PRIVATE_KEY: privateKey.optional(),
  AGENT_SECURITY_PRIVATE_KEY: privateKey.optional(),
  AGENT_MARKET_PRIVATE_KEY: privateKey.optional(),
  AGENT_HISTORY_PRIVATE_KEY: privateKey.optional(),
});

export type ServerEnv = z.infer<typeof ServerEnv>;

/**
 * Normalise raw environment values the way they are typically pasted into a dashboard:
 * surrounding whitespace and quotes are removed, an empty value means "not configured",
 * AI_PROVIDER is case-insensitive, and GOOGLE_API_KEY stands in for GEMINI_API_KEY.
 */
export function normalizeEnv(raw: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    const t = v.trim().replace(/^(["'])(.*)\1$/s, "$2").trim();
    if (t !== "") out[k] = t;
  }
  if (out.AI_PROVIDER) out.AI_PROVIDER = out.AI_PROVIDER.toLowerCase();
  if (!out.GEMINI_API_KEY && out.GOOGLE_API_KEY) out.GEMINI_API_KEY = out.GOOGLE_API_KEY;
  return out;
}

/**
 * Parse the environment. A malformed optional variable is dropped and reported by name
 * (never by value) instead of taking the whole server down: one mistyped signer key must
 * not stop the AI provider or the read-only pages from working.
 */
export function parseServerEnv(raw: Record<string, string | undefined>): { env: ServerEnv; invalid: string[] } {
  const values = normalizeEnv(raw);
  const invalid: string[] = [];
  for (;;) {
    const parsed = ServerEnv.safeParse(values);
    if (parsed.success) return { env: parsed.data, invalid };
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].filter((f) => f in values);
    if (fields.length === 0) throw new Error(`Invalid server environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    for (const f of fields) {
      invalid.push(f);
      delete values[f];
    }
  }
}

let cached: { env: ServerEnv; invalid: string[] } | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached.env;
}

/** Names of variables that were set but malformed and are therefore ignored. */
export function invalidEnvVars(): string[] {
  cached ??= parseServerEnv(process.env);
  return cached.invalid;
}
