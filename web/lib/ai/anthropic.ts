import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { WireOutput } from "@/lib/validation/model-output";
import { systemPrompt, userPrompt } from "./prompt";
import { ProviderUnavailableError, type DecisionProvider, type EvaluationRequest, type EvaluationResponse } from "./provider";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Claude implementation of DecisionProvider.
 *
 * Structured output constrains the response shape; the strict validator in
 * lib/validation/model-output.ts still runs on every result. Server-side refusal
 * fallbacks are enabled; the model that actually served the response is recorded.
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

  async evaluate(req: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationResponse> {
    const started = Date.now();
    let message;
    try {
      message = await this.client.beta.messages.parse(
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
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderUnavailableError("AI provider rejected credentials");
      if (err instanceof Anthropic.RateLimitError) throw new ProviderUnavailableError("AI provider rate limited");
      if (err instanceof Anthropic.APIError) throw new ProviderUnavailableError(`AI provider error ${err.status ?? ""}`.trim());
      throw err;
    }

    if (message.stop_reason === "refusal") throw new Error("Model declined to answer");
    if (message.stop_reason === "max_tokens") throw new Error("Model output truncated");

    const rawText = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return {
      provider: this.id,
      model: message.model,
      rawText,
      output: message.parsed_output ?? safeJson(rawText),
      latencyMs: Date.now() - started,
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
