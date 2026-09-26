import type { Fork } from "@/lib/types/protocol";
import type { AgentId, Choice, DecisionId, Probability, Score } from "./primitives";

/**
 * Aggregation (CONTRACT_SPEC.md §5). Keeps each agent's contribution so the verdict can
 * be traced back to individual decisions.
 */

export interface AggregationInput {
  agentId: AgentId;
  choice: Choice;
  score: Score;
  probability: Probability;
  reputationBps: bigint;
  weight: bigint; // probability × reputation / 10000
}

export interface AggregationGates {
  quorum: boolean;
  share: boolean;
  score: boolean;
}

export interface Aggregation {
  decisionId: DecisionId;
  source: "engine" | "preview"; // engine = read from DecisionEngine
  inputs: AggregationInput[]; // empty when read from chain without submissions
  support: Record<Fork, bigint>;
  total: bigint;
  leading: Fork;
  gates: AggregationGates | null; // not stored on-chain; available for previews
  passed: boolean;
  guardianRequired: boolean;
  guardianDeadline: number | null;
  /** null while a guardian decision is pending. */
  approved: Exclude<Fork, "ESCALATE"> | null;
  submissions: number;
  /**
   * Summary metrics of the leading choice, derived from the final submissions (null when
   * nothing was submitted):
   *   supportShareBps      = ⌊support[leading] × 10000 / total⌋   (compared with thresholdBps)
   *   aggregateScore       = ⌊Σ score / n⌋ over backers of leading  (the minActionScore gate value)
   *   aggregateProbability = ⌊Σ probability / n⌋ over backers of leading
   */
  supportShareBps: number | null;
  aggregateScore: Score | null;
  aggregateProbability: Probability | null;
}
