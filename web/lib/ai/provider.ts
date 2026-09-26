import type { AgentSpec } from "@/lib/jev/agents";
import type { JevQuestion } from "@/lib/jev/questions";
import type { JevState } from "@/lib/jev/state";

/**
 * AI provider abstraction. A provider turns (agent, state, questions) into raw
 * structured output. It has no access to keys, contracts or other agents' outputs,
 * and its output is untrusted until validated by lib/validation/model-output.ts.
 */

export interface EvaluationRequest {
  agent: AgentSpec;
  state: JevState;
  questions: JevQuestion[]; // only the questions assigned to this agent
  horizonSec: number;
  bandBps: number;
}

export interface EvaluationResponse {
  provider: string;
  model: string; // model id reported by the provider response
  rawText: string; // exact text returned, hashed for provenance
  output: unknown; // parsed JSON, unvalidated
  latencyMs: number;
}

export class ProviderUnavailableError extends Error {}

export interface DecisionProvider {
  readonly id: string;
  evaluate(req: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationResponse>;
}
