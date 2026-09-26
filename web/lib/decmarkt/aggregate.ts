import { BPS, FORKS, type Fork } from "@/lib/types/protocol";
import { TIE_BREAK_ORDER } from "@/lib/jev/forks";
import type { Aggregation, AggregationInput } from "@/lib/model/aggregation";
import type { AgentId, Choice, DecisionId, Probability, Score } from "@/lib/model/primitives";

/**
 * TypeScript mirror of DecisionEngine.aggregate (CONTRACT_SPEC.md §5).
 * Used for previews and cross-checked against the contract in tests. For a real
 * decision the UI always shows the contract's result.
 */

export interface AggregationSubmission {
  agentId: AgentId;
  choice: Choice;
  score: Score;
  probability: Probability;
  agentSubmitted: number; // resolved non-neutral submissions before this decision
  agentCorrect: number;
}

export interface AggregationConfig {
  thresholdBps: number;
  minActionScore: number;
  quorum: number;
}

export function reputationBps(submitted: number, correct: number): bigint {
  return (BigInt(correct + 1) * BigInt(BPS)) / BigInt(submitted + 2);
}

export function aggregate(decisionId: DecisionId, subs: readonly AggregationSubmission[], cfg: AggregationConfig): Aggregation {
  if (new Set(subs.map((s) => s.agentId)).size !== subs.length) throw new Error("One submission per agent");

  const inputs: AggregationInput[] = subs.map((s) => {
    const rep = reputationBps(s.agentSubmitted, s.agentCorrect);
    return { agentId: s.agentId, choice: s.choice, score: s.score, probability: s.probability, reputationBps: rep, weight: (BigInt(s.probability) * rep) / BigInt(BPS) };
  });
  const support = Object.fromEntries(FORKS.map((f) => [f, 0n])) as Record<Fork, bigint>;
  for (const i of inputs) support[i.choice] += i.weight;
  const total = FORKS.reduce((t, f) => t + support[f], 0n);

  let leading: Fork = TIE_BREAK_ORDER[0];
  for (const f of TIE_BREAK_ORDER) if (support[f] > support[leading]) leading = f;

  const quorum = subs.length >= cfg.quorum;
  const share = total > 0n && support[leading] * BigInt(BPS) >= BigInt(cfg.thresholdBps) * total;
  let score = true;
  if (leading === "DERISK" || leading === "DEPLOY") {
    const backers = subs.filter((s) => s.choice === leading);
    const sum = backers.reduce((t, s) => t + s.score, 0);
    score = Math.floor(sum / Math.max(backers.length, 1)) >= cfg.minActionScore;
  }
  const passed = quorum && share && score;
  const guardianRequired = passed && leading === "ESCALATE";
  const approved = !passed ? "NO_ACTION" : guardianRequired ? null : (leading as Exclude<Fork, "ESCALATE">);

  return {
    decisionId,
    source: "preview",
    inputs,
    support,
    total,
    leading,
    gates: { quorum, share, score },
    passed,
    guardianRequired,
    guardianDeadline: null,
    approved,
    submissions: subs.length,
  };
}
