import "server-only";
import { serverEnv } from "@/lib/config/server";
import { unavailable, ok, type Availability } from "@/lib/types/protocol";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import type { DecisionProvider } from "./provider";

export type { DecisionProvider, EvaluationRequest, EvaluationResponse } from "./provider";

const DEFAULTS = {
  gemini: { model: "gemini-3.8-flash", fallback: ["gemini-3.7-flash", "gemini-3.6-flash"], keyEnv: "GEMINI_API_KEY" },
  anthropic: { model: "claude-opus-5", fallback: [], keyEnv: "ANTHROPIC_API_KEY" },
} as const;

type ProviderId = keyof typeof DEFAULTS;

/** The configured provider and model, without constructing a client. Never exposes key values. */
export function providerConfig(): { provider: ProviderId; model: string; fallback: readonly string[]; key: string | undefined; keyEnv: string } {
  const env = serverEnv();
  const provider: ProviderId = env.AI_PROVIDER ?? (env.GEMINI_API_KEY ? "gemini" : "anthropic");
  const d = DEFAULTS[provider];
  return {
    provider,
    model: env.AI_MODEL ?? d.model,
    fallback: env.AI_FALLBACK_MODEL ? env.AI_FALLBACK_MODEL.split(",").map((m) => m.trim()).filter(Boolean) : d.fallback,
    key: provider === "gemini" ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY,
    keyEnv: d.keyEnv,
  };
}

/** Resolve the configured provider, or report exactly why none is available. */
export function getDecisionProvider(): Availability<DecisionProvider> {
  const c = providerConfig();
  if (!c.key) return unavailable(`${c.keyEnv} is not configured on the server`);
  return ok(c.provider === "gemini" ? new GeminiProvider(c.key, c.model, c.fallback) : new AnthropicProvider(c.key, c.model));
}

export function providerStatus(): { configured: boolean; provider: string; model: string | null; reason?: string } {
  const c = providerConfig();
  return c.key
    ? { configured: true, provider: c.provider, model: c.model }
    : { configured: false, provider: c.provider, model: null, reason: `${c.keyEnv} is not configured` };
}
