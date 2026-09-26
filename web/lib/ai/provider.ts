import type { AgentSpec } from "@/lib/jev/agents";
import type { AgentFailureKind } from "@/lib/model/decision";
import type { Question } from "@/lib/model/question";
import type { StateSlice } from "@/lib/model/state";

/**
 * AI provider abstraction. A provider turns (agent, relevant state, questions) into raw
 * text. It has no access to keys, contracts, thresholds or other agents' outputs; its
 * text is untrusted until the Jev layer parses and validates it.
 */

export interface EvaluationRequest {
  agent: AgentSpec;
  /** The state, reduced to the inputs relevant to this agent's questions. */
  state: StateSlice;
  questions: Question[]; // only the questions assigned to this agent
  horizonSec: number;
  bandBps: number;
}

export interface EvaluationResponse {
  provider: string;
  model: string; // model id reported by the provider response
  rawText: string; // exact text returned; parsed and validated by the Jev layer
  latencyMs: number;
}

/** A classified provider failure. Anything else thrown is treated as provider_error. */
export class ProviderError extends Error {
  constructor(
    readonly kind: Exclude<AgentFailureKind, "invalid_json" | "schema_violation">,
    message: string,
    readonly model: string | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface DecisionProvider {
  readonly id: string;
  evaluate(req: EvaluationRequest, signal: AbortSignal): Promise<EvaluationResponse>;
}
