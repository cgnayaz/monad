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
  AI_PROVIDER: z.enum(["gemini", "anthropic", "openai", "groq", "openrouter"]).optional(),
  /** Gemini key; GOOGLE_API_KEY (the SDK's own variable name) is accepted as an alias. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, …): key, base URL and model. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  /** Presets: base URL and default model are filled in for these. */
  GROQ_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  /** Model id; default depends on the provider (see lib/ai/index.ts). */
  AI_MODEL: z.string().min(1).optional(),
  /** Gemini only: comma-separated models tried when the primary is overloaded or out of quota. */
  AI_FALLBACK_MODEL: z.string().min(1).optional(),
  PYTH_HERMES_URL: z.string().url().default("https://pyth.dourolabs.app/hermes"),
  PYTH_API_KEY: z.string().min(1).optional(),
  /** One secret from which all signer keys (and the session key) are derived when not set explicitly. */
  SIGNER_SEED: z.string().min(32).optional(),
  PROPOSER_PRIVATE_KEY: privateKey.optional(),
  KEEPER_PRIVATE_KEY: privateKey.optional(),
  AGENT_RISK_PRIVATE_KEY: privateKey.optional(),
  AGENT_YIELD_PRIVATE_KEY: privateKey.optional(),
  AGENT_SECURITY_PRIVATE_KEY: privateKey.optional(),
  AGENT_MARKET_PRIVATE_KEY: privateKey.optional(),
  AGENT_HISTORY_PRIVATE_KEY: privateKey.optional(),
});

export type ServerEnv = z.infer<typeof ServerEnv>;

/** Names accepted for the Gemini key, in order of preference. */
export const GEMINI_KEY_NAMES = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GEMINI_KEY"] as const;
/** Names accepted for the Pyth Hermes key, in order of preference. */
export const PYTH_KEY_NAMES = ["PYTH_API_KEY", "PYTH_HERMES_API_KEY", "HERMES_API_KEY", "PYTH_KEY", "PYTH_HERMES_KEY"] as const;

/** A variable name as typed into a dashboard, reduced to its canonical form ("gemini api key " → GEMINI_API_KEY). */
const canonicalName = (k: string) => k.trim().toUpperCase().replace(/[\s-]+/g, "_");

/**
 * Normalise raw environment values the way they are typically pasted into a dashboard:
 * surrounding whitespace and quotes are removed, an empty value means "not configured",
 * names are matched case- and whitespace-insensitively, AI_PROVIDER is case-insensitive,
 * and the usual alternative names for the Gemini key are accepted.
 */
export function normalizeEnv(raw: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const loose: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    const t = v.trim().replace(/^(["'])(.*)\1$/s, "$2").trim();
    if (t === "") continue;
    out[k] = t;
    loose[canonicalName(k)] ??= t;
  }
  for (const name of [...Object.keys(ServerEnv.shape), ...GEMINI_KEY_NAMES, ...PYTH_KEY_NAMES]) if (!out[name] && loose[name]) out[name] = loose[name];
  if (out.AI_PROVIDER) out.AI_PROVIDER = out.AI_PROVIDER.toLowerCase();
  const gemini = GEMINI_KEY_NAMES.map((n) => out[n]).find(Boolean);
  if (gemini) out.GEMINI_API_KEY = gemini;
  const pyth = PYTH_KEY_NAMES.map((n) => out[n]).find(Boolean);
  if (pyth) out.PYTH_API_KEY = pyth;
  return out;
}

/**
 * What the dashboard needs to explain a missing key, by name only (never values): which
 * deployment this is, which name the Gemini key came from, and any similarly named
 * variables that were not recognised.
 */
export function envDiagnostics(raw: Record<string, string | undefined> = process.env): {
  deployment: string | null;
  commit: string | null;
  geminiKeyName: string | null;
  pythKeyName: string | null;
  similarNames: string[];
} {
  const set = Object.entries(raw).filter(([, v]) => v !== undefined && v.trim() !== "").map(([k]) => k);
  const geminiKeyName = set.find((k) => (GEMINI_KEY_NAMES as readonly string[]).includes(canonicalName(k))) ?? null;
  const pythKeyName = set.find((k) => (PYTH_KEY_NAMES as readonly string[]).includes(canonicalName(k))) ?? null;
  const similarNames = set.filter((k) => /GEMINI|GOOGLE|GENAI|PYTH|HERMES/i.test(k) && k !== geminiKeyName && k !== pythKeyName && canonicalName(k) !== "PYTH_HERMES_URL");
  const vercel = raw.VERCEL_ENV?.trim();
  return { deployment: vercel || (raw.NODE_ENV === "production" ? "production (yerel)" : null), commit: raw.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, geminiKeyName, pythKeyName, similarNames };
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
