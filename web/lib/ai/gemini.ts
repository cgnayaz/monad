import "server-only";
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { WireOutput } from "@/lib/validation/model-output";
import { systemPrompt, userPrompt } from "./prompt";
import { ProviderError, type DecisionProvider, type EvaluationRequest, type EvaluationResponse } from "./provider";

/** Structured-output schema sent to Gemini; the Jev layer still validates every response. */
const RESPONSE_SCHEMA = (() => {
  const schema = z.toJSONSchema(WireOutput) as Record<string, unknown>;
  delete schema.$schema; // Gemini's JSON-schema subset does not take the meta-schema key
  return schema;
})();

/**
 * Gemini implementation of DecisionProvider (official @google/genai SDK).
 *
 * Structured output constrains the response to the WireOutput shape; the text is returned
 * raw so parsing and the strict schema check happen in the Jev layer, identically for
 * every provider. When a model is overloaded (HTTP 5xx) or out of quota (429), the request
 * moves to the next fallback model, and after a short backoff tries the list once more, all
 * within the agent's time limit. The model that actually answered is recorded with the run.
 */
export class GeminiProvider implements DecisionProvider {
  readonly id = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly fallbackModels: readonly string[],
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async evaluate(req: EvaluationRequest, signal: AbortSignal): Promise<EvaluationResponse> {
    const started = Date.now();
    const models = [this.model, ...this.fallbackModels.filter((m) => m !== this.model)];
    let last: unknown;
    for (let pass = 0; pass < 2; pass++) {
      for (const model of models) {
        try {
          return await this.call(model, req, signal, started);
        } catch (err) {
          last = err;
          const retryable = err instanceof ApiError && (err.status === 429 || err.status >= 500);
          if (!retryable || signal.aborted) throw classify(err, signal, this.model);
        }
      }
      if (pass === 0) await backoff(1_500 + Math.random() * 1_500, signal);
    }
    throw classify(last, signal, this.model);
  }

  private async call(model: string, req: EvaluationRequest, signal: AbortSignal, started: number): Promise<EvaluationResponse> {
    const res = await this.client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt(req) }] }],
      config: {
        systemInstruction: systemPrompt(req),
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
        // thinkingLevel exists from Gemini 3 on; older models (set via AI_MODEL) reject it.
        ...(supportsThinkingLevel(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        maxOutputTokens: 16_000,
        abortSignal: signal,
      },
    });
    const answeredBy = res.modelVersion ?? model;
    if (res.promptFeedback?.blockReason) throw new ProviderError("refusal", `Model yanıt vermeyi reddetti (${res.promptFeedback.blockReason})`, answeredBy);
    const finish = res.candidates?.[0]?.finishReason;
    if (finish === FinishReason.MAX_TOKENS) throw new ProviderError("truncated", "Model çıktısı token sınırına ulaştı", answeredBy);
    if (finish && finish !== FinishReason.STOP) throw new ProviderError("refusal", `Model yanıt vermeden durdu (${finish})`, answeredBy);
    return { provider: this.id, model: answeredBy, rawText: res.text ?? "", latencyMs: Date.now() - started };
  }
}

/** Gemini 3 and later accept thinkingConfig.thinkingLevel; unknown ids are assumed current. */
export function supportsThinkingLevel(model: string): boolean {
  const m = /^(?:models\/)?gemini-(\d+)/.exec(model);
  return !m || Number(m[1]) >= 3;
}

function backoff(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

function classify(err: unknown, signal: AbortSignal, model: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal.aborted) return new ProviderError("timeout", "Ajan süre sınırı içinde yanıt gelmedi");
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) return new ProviderError("provider_error", "Sağlayıcı API anahtarını reddetti (GEMINI_API_KEY geçersiz)");
    if (err.status === 400 && /location is not supported/i.test(err.message)) return new ProviderError("provider_error", "Gemini API bu sunucu bölgesinde kullanılamıyor");
    if (err.status === 402) return new ProviderError("provider_error", "Gemini hesabının ön ödemeli kredisi bitti (AI Studio → Billing ya da yeni projede yeni anahtar)");
    if (err.status === 401 || err.status === 403) return new ProviderError("provider_error", "Sağlayıcı bu anahtara erişim izni vermedi");
    if (err.status === 404) return new ProviderError("provider_error", `${model} modeli bu anahtar için kullanılamıyor`);
    if (err.status === 429) return new ProviderError("provider_error", "Sağlayıcı kotası veya hız sınırı doldu");
    if (err.status >= 500) return new ProviderError("provider_error", `Sağlayıcı kullanılamıyor (HTTP ${err.status})`);
    return new ProviderError("provider_error", `Sağlayıcı HTTP ${err.status} döndürdü`);
  }
  if (err instanceof Error && err.name === "AbortError") return new ProviderError("timeout", "İstek iptal edildi");
  if (err instanceof TypeError && /fetch/i.test(err.message)) return new ProviderError("provider_error", "Sağlayıcıya ulaşılamadı");
  return new ProviderError("provider_error", "Bilinmeyen sağlayıcı hatası");
}
