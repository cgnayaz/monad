import "server-only";
import { z } from "zod";
import { WireOutput } from "@/lib/validation/model-output";
import { systemPrompt, userPrompt } from "./prompt";
import { ProviderError, type DecisionProvider, type EvaluationRequest, type EvaluationResponse } from "./provider";

/** JSON schema of the answer, given to the model in the prompt; the Jev layer still validates every response. */
const SCHEMA_TEXT = JSON.stringify(
  (() => {
    const s = z.toJSONSchema(WireOutput) as Record<string, unknown>;
    delete s.$schema;
    return s;
  })(),
);

export interface OpenAICompatibleConfig {
  /** Short provider name recorded with each run (groq, openrouter, openai, …). */
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModels: readonly string[];
}

type ChatBody = { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]; error?: { message?: string } };

/** One chat completion against an OpenAI-compatible endpoint (Groq, OpenRouter, OpenAI, …). */
export async function chatCompletion(
  c: OpenAICompatibleConfig,
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: { json: boolean; maxTokens: number; signal: AbortSignal },
): Promise<{ text: string; model: string; finish: string | null }> {
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: opts.maxTokens, ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (opts.signal.aborted) throw new ProviderError("timeout", "Ajan süre sınırı içinde yanıt gelmedi");
    throw new ProviderError("provider_error", `${c.name} sağlayıcısına ulaşılamadı${err instanceof Error ? `: ${err.message}` : ""}`);
  }
  const body = (await res.json().catch(() => null)) as ChatBody | null;
  if (!res.ok) throw httpError(c, model, res.status, body?.error?.message);
  const choice = body?.choices?.[0];
  return { text: choice?.message?.content ?? "", model: body?.model ?? model, finish: choice?.finish_reason ?? null };
}

function httpError(c: OpenAICompatibleConfig, model: string, status: number, message?: string): ProviderError {
  const detail = message ? `: ${message.slice(0, 160)}` : "";
  if (status === 401 || status === 403) return new ProviderError("provider_error", `${c.name} API anahtarını reddetti (HTTP ${status})`);
  if (status === 402) return new ProviderError("provider_error", `${c.name} hesabında kredi yok (HTTP 402)`);
  if (status === 404) return new ProviderError("provider_error", `${model} modeli ${c.name} üzerinde bulunamadı (HTTP 404)`);
  if (status === 429) return new ProviderError("provider_error", `${c.name} kotası veya hız sınırı doldu (HTTP 429)`);
  if (status >= 500) return new ProviderError("provider_error", `${c.name} kullanılamıyor (HTTP ${status})`);
  return new ProviderError("provider_error", `${c.name} HTTP ${status} döndürdü${detail}`);
}

const retryable = (e: unknown) => e instanceof ProviderError && /HTTP (429|5\d\d)/.test(e.message);

/**
 * OpenAI-compatible implementation of DecisionProvider. Same prompt and the same strict
 * validation as every other provider: the text is returned raw and the Jev layer parses it.
 */
export class OpenAICompatibleProvider implements DecisionProvider {
  readonly id: string;

  constructor(private readonly c: OpenAICompatibleConfig) {
    this.id = c.name;
  }

  async evaluate(req: EvaluationRequest, signal: AbortSignal): Promise<EvaluationResponse> {
    const started = Date.now();
    const messages = [
      { role: "system" as const, content: `${systemPrompt(req)}\n\nRespond with one JSON object only, no prose, matching this JSON schema exactly:\n${SCHEMA_TEXT}` },
      { role: "user" as const, content: userPrompt(req) },
    ];
    const models = [this.c.model, ...this.c.fallbackModels.filter((m) => m !== this.c.model)];
    let last: unknown;
    for (const model of models) {
      try {
        const r = await chatCompletion(this.c, model, messages, { json: true, maxTokens: 4_000, signal });
        if (r.finish === "length") throw new ProviderError("truncated", "Model çıktısı token sınırına ulaştı", r.model);
        if (r.finish === "content_filter") throw new ProviderError("refusal", "Model yanıt vermeyi reddetti", r.model);
        return { provider: this.id, model: r.model, rawText: r.text, latencyMs: Date.now() - started };
      } catch (err) {
        last = err;
        if (!retryable(err) || signal.aborted) break;
      }
    }
    throw last instanceof ProviderError ? last : new ProviderError("provider_error", "Bilinmeyen sağlayıcı hatası");
  }
}

/**
 * Tries each provider in order and moves on only when one fails for provider reasons (key,
 * credit, quota, outage). Timeouts, refusals and truncation are the model's answer and stop
 * here, so a round never spends its time budget twice.
 */
export class FallbackProvider implements DecisionProvider {
  readonly id: string;

  constructor(private readonly providers: readonly DecisionProvider[]) {
    this.id = providers.map((p) => p.id).join("→");
  }

  async evaluate(req: EvaluationRequest, signal: AbortSignal): Promise<EvaluationResponse> {
    let last: unknown;
    for (const p of this.providers) {
      try {
        return await p.evaluate(req, signal);
      } catch (err) {
        last = err;
        if (!(err instanceof ProviderError && err.kind === "provider_error") || signal.aborted) throw err;
      }
    }
    throw last;
  }
}
