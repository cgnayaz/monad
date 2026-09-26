import "server-only";
import { z } from "zod";

/**
 * Server-only configuration. Secrets are read lazily so that pages which do not need
 * them still build and render; a missing secret surfaces as an explicit
 * "unavailable" state rather than a crash or a placeholder.
 */

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x-prefixed 32-byte hex");

const ServerEnv = z.object({
  /** Which provider runs the agents. Default: gemini when GEMINI_API_KEY is set, else anthropic. */
  AI_PROVIDER: z.enum(["gemini", "anthropic"]).optional(),
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

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    // An empty value (e.g. copied from .env.example) means "not configured", not "malformed".
    const defined = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
    const parsed = ServerEnv.safeParse(defined);
    if (!parsed.success) {
      // Report which variables are malformed, never their values.
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
