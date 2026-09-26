import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { WireOutput } from "@/lib/validation/model-output";
import { systemPrompt, userPrompt } from "./prompt";
import { ProviderError, type DecisionProvider, type EvaluationRequest, type EvaluationResponse } from "./provider";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Claude implementation of DecisionProvider.
 *
 * Structured output constrains the response shape, but the text is returned raw: parsing
 * and the strict schema check happen in the Jev layer, so invalid JSON and schema
 * violations are classified identically for every provider. Server-side refusal
 * fallbacks are enabled; the model that actually answered is recorded.
 */
export class AnthropicProvider implements DecisionProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly effort: Effort = "medium",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 1 });
  }

  async evaluate(req: EvaluationRequest, signal: AbortSignal): Promise<EvaluationResponse> {
    const started = Date.now();
    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16_000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: this.effort, format: betaZodOutputFormat(WireOutput) },
          system: systemPrompt(req),
          messages: [{ role: "user", content: userPrompt(req) }],
        },
        { signal },
      );
    } catch (err) {
      if (signal.aborted) throw new ProviderError("timeout", "Ajan süre sınırı içinde yanıt gelmedi");
      if (err instanceof Anthropic.APIUserAbortError) throw new ProviderError("timeout", "İstek iptal edildi");
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("provider_error", "Sağlayıcı API anahtarını reddetti (ANTHROPIC_API_KEY geçersiz)");
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("provider_error", "Sağlayıcı hız sınırı doldu");
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError("timeout", "Sağlayıcı bağlantısı zaman aşımına uğradı");
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("provider_error", "Sağlayıcıya ulaşılamadı");
      if (err instanceof Anthropic.PermissionDeniedError) throw new ProviderError("provider_error", "Sağlayıcı bu anahtara erişim izni vermedi");
      if (err instanceof Anthropic.NotFoundError) throw new ProviderError("provider_error", `${this.model} modeli bu anahtar için kullanılamıyor`);
      if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) throw new ProviderError("provider_error", "Sağlayıcı hesabında kredi kalmadı");
      if (err instanceof Anthropic.InternalServerError) throw new ProviderError("provider_error", `Sağlayıcı kullanılamıyor (HTTP ${err.status})`);
      if (err instanceof Anthropic.APIError) throw new ProviderError("provider_error", `Sağlayıcı HTTP ${err.status ?? "hatası"} döndürdü`);
      throw new ProviderError("provider_error", "Bilinmeyen sağlayıcı hatası");
    }

    if (message.stop_reason === "refusal") throw new ProviderError("refusal", "Model yanıt vermeyi reddetti", message.model);
    if (message.stop_reason === "max_tokens") throw new ProviderError("truncated", "Model çıktısı token sınırına ulaştı", message.model);

    return {
      provider: this.id,
      model: message.model,
      rawText: message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      latencyMs: Date.now() - started,
    };
  }
}
