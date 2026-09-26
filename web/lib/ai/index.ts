import "server-only";
import { invalidEnvVars, serverEnv } from "@/lib/config/server";
import { unavailable, ok, type Availability } from "@/lib/types/protocol";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { FallbackProvider, OpenAICompatibleProvider, type OpenAICompatibleConfig } from "./openai-compatible";
import type { DecisionProvider } from "./provider";

export type { DecisionProvider, EvaluationRequest, EvaluationResponse } from "./provider";

const DEFAULTS = {
  gemini: { model: "gemini-3.8-flash", fallback: ["gemini-3.7-flash", "gemini-3.6-flash"], keyEnv: "GEMINI_API_KEY" },
  anthropic: { model: "claude-opus-5", fallback: [], keyEnv: "ANTHROPIC_API_KEY" },
} as const;

type ProviderId = keyof typeof DEFAULTS;
const COMPAT_IDS = ["openai", "groq", "openrouter"] as const;

/** The configured provider and model, without constructing a client. Never exposes key values. */
export function providerConfig(): { provider: ProviderId; model: string; fallback: readonly string[]; key: string | undefined; keyEnv: string } {
  const env = serverEnv();
  const selected = env.AI_PROVIDER && !(COMPAT_IDS as readonly string[]).includes(env.AI_PROVIDER) ? (env.AI_PROVIDER as ProviderId) : undefined;
  // Gemini is the default; Anthropic only when explicitly selected or when it is the only key present.
  const provider: ProviderId = selected ?? (!env.GEMINI_API_KEY && env.ANTHROPIC_API_KEY ? "anthropic" : "gemini");
  const d = DEFAULTS[provider];
  return {
    provider,
    model: env.AI_MODEL ?? d.model,
    fallback: env.AI_FALLBACK_MODEL ? env.AI_FALLBACK_MODEL.split(",").map((m) => m.trim()).filter(Boolean) : d.fallback,
    key: provider === "gemini" ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY,
    keyEnv: d.keyEnv,
  };
}

/**
 * The OpenAI-compatible provider, when a key is configured: OPENAI_* (any endpoint), or the
 * GROQ_API_KEY / OPENROUTER_API_KEY presets. Returns a reason instead when it cannot run.
 */
export function compatConfig(): OpenAICompatibleConfig | { reason: string } | null {
  const env = serverEnv();
  const groq = !env.OPENAI_API_KEY && env.GROQ_API_KEY;
  const router = !env.OPENAI_API_KEY && !groq && env.OPENROUTER_API_KEY;
  const apiKey = env.OPENAI_API_KEY ?? env.GROQ_API_KEY ?? env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const name = groq ? "groq" : router ? "openrouter" : env.OPENAI_BASE_URL ? new URL(env.OPENAI_BASE_URL).hostname.replace(/^api\./, "").split(".")[0] : "openai";
  const baseUrl = env.OPENAI_BASE_URL ?? (groq ? "https://api.groq.com/openai/v1" : router ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  // Groq's documented production model; other endpoints need OPENAI_MODEL (no guessed names).
  const model = env.OPENAI_MODEL ?? (groq ? "llama-3.3-70b-versatile" : undefined);
  if (!model) return { reason: `${name} için OPENAI_MODEL tanımlı değil` };
  return { name, baseUrl, apiKey, model, fallbackModels: [] };
}

/** Providers in the order they are tried. */
function chain(): { providers: DecisionProvider[]; labels: string[]; reasons: string[] } {
  const env = serverEnv();
  const c = providerConfig();
  const compat = compatConfig();
  type Entry = { p: DecisionProvider; label: string } | null;
  const classic: Entry = c.key ? { p: c.provider === "gemini" ? new GeminiProvider(c.key, c.model, c.fallback) : new AnthropicProvider(c.key, c.model), label: `${c.provider} · ${c.model}` } : null;
  const alt: Entry = compat && !("reason" in compat) ? { p: new OpenAICompatibleProvider(compat), label: `${compat.name} · ${compat.model}` } : null;
  const compatFirst = !!env.AI_PROVIDER && (COMPAT_IDS as readonly string[]).includes(env.AI_PROVIDER);
  const ordered = (compatFirst ? [alt, classic] : [classic, alt]).filter((x): x is { p: DecisionProvider; label: string } => !!x);
  const reasons = [...(classic ? [] : [missingKeyReason(c.keyEnv)]), ...(compat && "reason" in compat ? [compat.reason] : [])];
  return { providers: ordered.map((x) => x.p), labels: ordered.map((x) => x.label), reasons };
}

/** Resolve the configured provider(s), or report exactly why none is available. */
export function getDecisionProvider(): Availability<DecisionProvider> {
  const { providers, reasons } = chain();
  if (providers.length === 0) return unavailable(reasons.join("; ") || "AI sağlayıcı yapılandırılmamış");
  return ok(providers.length === 1 ? providers[0] : new FallbackProvider(providers));
}

export function providerStatus(): { configured: boolean; provider: string; model: string | null; reason?: string } {
  const { providers, labels, reasons } = chain();
  const c = providerConfig();
  return providers.length
    ? { configured: true, provider: labels.join(" → yedek: "), model: null }
    : { configured: false, provider: c.provider, model: null, reason: reasons.join("; ") };
}

function missingKeyReason(keyEnv: string): string {
  const invalid = invalidEnvVars().filter((v) => v === "AI_PROVIDER" || v.endsWith("_API_KEY"));
  return invalid.length
    ? `${keyEnv} sunucuda yapılandırılmamış (geçersiz değer yok sayıldı: ${invalid.join(", ")})`
    : `${keyEnv} sunucuda yapılandırılmamış`;
}
