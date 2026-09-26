import type { AgentKey, Hex } from "@/lib/types/protocol";
import type { AgentId, DecisionId, JevPrimitives, UnixSeconds, Wei } from "./primitives";
import type { QuestionId } from "./question";
import type { StateId } from "./state";

/**
 * Agent decisions, parallel runs and batches (JEV_INTEGRATION.md §6–9).
 */

export interface FactorRating {
  factor: string;
  rating: 0 | 1 | 2 | 3 | 4;
  evidence: string[]; // state input keys
}

/**
 * One agent's decision on one question. Choice, Score and Probability are typed
 * fields — never nested in free-form JSON.
 */
export interface AgentDecision extends JevPrimitives {
  agentId: AgentId;
  decisionId: DecisionId;
  questionId: QuestionId;
  questionIndex: number; // on-chain leaf slot
  reason: string;
  reasonHash: Hex;
  factors: FactorRating[];
  /** Bond this agent has locked for the decision (shared by all answers in its batch). */
  bond: Wei;
  timestamp: UnixSeconds;
}

export interface BatchLeaf {
  questionId: QuestionId;
  questionIndex: number;
  leafHash: Hex;
  proof: Hex[];
}

/**
 * All of one agent's answers in one decision, evaluated as a single logical batch and
 * committed as `answersRoot`. Question-level provenance is kept per leaf.
 */
export interface DecisionBatch {
  batchId: `bt_${string}`;
  decisionId: DecisionId;
  stateId: StateId;
  agentId: AgentId;
  decisions: AgentDecision[]; // sorted by questionIndex
  answersRoot: Hex;
  leaves: BatchLeaf[];
}

export type RunValidation = { ok: true } | { ok: false; errors: string[] };

/** Provenance of one agent's independent evaluation. */
export interface AgentRun {
  decisionId: DecisionId;
  stateId: StateId;
  agentId: AgentId;
  agentKey: AgentKey;
  provider: string;
  model: string | null; // as reported by the provider response
  rubricVersion: string;
  startedAt: number; // ms
  finishedAt: number; // ms
  rawOutputHash: Hex | null;
  validation: RunValidation;
  batch: DecisionBatch | null; // null when validation failed
  /** The agent's final decision: its answer to the ACTION question. */
  final: AgentDecision | null;
}

/**
 * Every agent's independent run for one decision. Keyed by agent, so there is exactly
 * one run per agent and no run can overwrite or merge into another.
 */
export interface ParallelDecisions {
  decisionId: DecisionId;
  stateId: StateId;
  questionSetHash: Hex;
  runs: Readonly<Record<AgentKey, AgentRun>>;
}

/**
 * One answer as stored on-chain by DecisionRegistry.submit / submitBatch. Every question
 * an agent answers is its own record; the record for question 0 (ACTION) is the agent's
 * final decision. `answersRoot` of a DecisionBatch is an off-chain payload commitment.
 */
export interface SubmissionRecord extends JevPrimitives {
  decisionId: DecisionId;
  agentId: AgentId;
  questionIndex: number;
  reasonHash: Hex;
  bond: Wei;
  submittedAt: UnixSeconds;
}
