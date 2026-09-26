import "server-only";
import { serverEnv } from "@/lib/config/server";
import { unavailable, ok, type Availability } from "@/lib/types/protocol";
import { AnthropicProvider } from "./anthropic";
import type { DecisionProvider } from "./provider";

export type { DecisionProvider, EvaluationRequest, EvaluationResponse } from "./provider";

/** Resolve the configured provider, or report exactly why none is available. */
export function getDecisionProvider(): Availability<DecisionProvider> {
  const env = serverEnv();
  if (!env.ANTHROPIC_API_KEY) return unavailable("ANTHROPIC_API_KEY is not configured on the server");
  return ok(new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL));
}

export function providerStatus(): { configured: boolean; provider: string; model: string | null; reason?: string } {
  const env = serverEnv();
  return env.ANTHROPIC_API_KEY
    ? { configured: true, provider: "anthropic", model: env.AI_MODEL }
    : { configured: false, provider: "anthropic", model: null, reason: "ANTHROPIC_API_KEY is not configured" };
}
