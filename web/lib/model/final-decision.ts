import type { Fork, Hex, Status } from "@/lib/types/protocol";
import type { Action } from "./action";
import type { Aggregation } from "./aggregation";
import type { AgentDecision, AgentFailure, AgentRun, ParallelDecisions } from "./decision";
import type { Choice, DecisionId, Probability, Score, UnixSeconds } from "./primitives";
import type { QuestionSet } from "./question";
import type { StateRecord } from "./state";
import type { TxRef } from "./transaction";

/**
 * The structured result of one run of the Jev decision pipeline (JEV_INTEGRATION.md §12).
 *
 *   STATE → QUESTIONS → PARALLEL DECISIONS → CHOICE/SCORE/PROBABILITY → AGGREGATION
 *         → BOUNDED ACTION → (execution layer) → VERIFY
 *
 * mode "live":    state and questions were committed on-chain before any agent ran, and
 *                 the bounded action was handed to the DecMarkt execution layer.
 * mode "simulation": the same pipeline on real state with real agents, but nothing was written
 *                 on-chain (decisionId "0", which is never a valid on-chain id).
 */

export const SIMULATION_DECISION_ID = "0";

export interface DecisionParameters {
  submissionWindow: number;
  horizon: number;
  bandBps: number;
  thresholdBps: number;
  minActionScore: number;
  quorum: number;
  allowedForks: Fork[];
  lockPerAgent: bigint;
}

export interface ThresholdEvaluation {
  thresholdBps: number;
  supportShareBps: number | null;
  quorum: number;
  submissions: number;
  minActionScore: number;
  gates: { quorum: boolean; share: boolean; score: boolean };
  passed: boolean;
}

export type AgentOutcome =
  | { agentId: number; agentKey: string; status: "ok"; final: AgentDecision }
  | { agentId: number; agentKey: string; status: "failed"; failure: AgentFailure };

export type ExecutionHandoff =
  | { status: "not-submitted"; reason: string }
  | {
      status: "submitted";
      decisionId: DecisionId;
      onChainStatus: Status;
      transactions: TxRef[];
      submissionErrors: { agentId: number; message: string }[];
      /** Local deterministic aggregation equals DecisionEngine's (null until aggregated on-chain). */
      aggregationMatchesChain: boolean | null;
      /** What still has to happen, and when it becomes possible. */
      next: { step: string; availableAt: UnixSeconds | null; reason: string } | null;
    };

export interface FinalDecision {
  version: "decmarkt.final-decision/1";
  mode: "live" | "simulation";
  decisionId: DecisionId;
  createdAt: UnixSeconds;
  parameters: DecisionParameters;
  state: StateRecord;
  questions: QuestionSet;
  parallel: ParallelDecisions;
  /** Every individual answer of every agent (all questions), in agent then question order. */
  agentDecisions: AgentDecision[];
  agents: AgentOutcome[];
  aggregation: Aggregation;
  aggregateScore: Score | null;
  aggregateProbability: Probability | null;
  /** The leading choice of the aggregation (may differ from the executed action on fail-safe). */
  selectedChoice: Choice;
  threshold: ThresholdEvaluation;
  /** The bounded action authorised by the deterministic rules; null while a guardian must decide. */
  action: Action | null;
  execution: ExecutionHandoff;
  reputationSource: "chain" | "none-recorded";
  /** Whether state, questions and runs were written to the payload store (live mode). */
  payloads: { stored: boolean; detail: string };
}

// ─── Streaming events (NDJSON over /api/decisions) ─────────────────────────

export const PIPELINE_STAGES = [
  "STATE",
  "QUESTIONS",
  "COMMIT",
  "PARALLEL_DECISIONS",
  "SUBMIT",
  "AGGREGATION",
  "ACTION",
  "EXECUTION",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type StageStatus = "running" | "done" | "skipped" | "failed";

export type PipelineEvent =
  | { type: "stage"; stage: PipelineStage; status: StageStatus; detail?: string; txs?: TxRef[] }
  | { type: "state"; state: StateRecord }
  | { type: "questions"; questions: QuestionSet }
  | { type: "agent"; run: AgentRun }
  | { type: "submission"; agentId: number; tx: TxRef | null; error: string | null }
  | { type: "result"; decision: FinalDecision }
  | { type: "error"; message: string };

export type { Hex };
