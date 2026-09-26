import { BPS, FORKS, type Fork } from "@/lib/types/protocol";
import { TIE_BREAK_ORDER } from "@/lib/jev/forks";

/**
 * TypeScript mirror of DecisionEngine.aggregate (CONTRACT_SPEC.md §5).
 * Used for previews and cross-checked against the contract in tests. The contract
 * result is always what the UI displays for a real decision.
 */

export interface AggregationSubmission {
  choice: Fork;
  score: number;
  probability: number;
  agentSubmitted: number; // resolved non-neutral submissions before this decision
  agentCorrect: number;
}

export interface AggregationConfig {
  thresholdBps: number;
  minActionScore: number;
  quorum: number;
}

export interface AggregationResult {
  support: Record<Fork, bigint>;
  total: bigint;
  leading: Fork;
  gates: { quorum: boolean; share: boolean; score: boolean };
  passed: boolean;
  guardianRequired: boolean;
  approved: Fork | null; // null while a guardian decision is pending
}

export function reputationBps(submitted: number, correct: number): bigint {
  return (BigInt(correct + 1) * BigInt(BPS)) / BigInt(submitted + 2);
}

export function aggregate(subs: readonly AggregationSubmission[], cfg: AggregationConfig): AggregationResult {
  const support = Object.fromEntries(FORKS.map((f) => [f, 0n])) as Record<Fork, bigint>;
  for (const s of subs) {
    const w = (BigInt(s.probability) * reputationBps(s.agentSubmitted, s.agentCorrect)) / BigInt(BPS);
    support[s.choice] += w;
  }
  const total = FORKS.reduce((t, f) => t + support[f], 0n);

  let leading: Fork = TIE_BREAK_ORDER[0];
  for (const f of TIE_BREAK_ORDER) if (support[f] > support[leading]) leading = f;

  const quorum = subs.length >= cfg.quorum;
  const share = total > 0n && support[leading] * BigInt(BPS) >= BigInt(cfg.thresholdBps) * total;
  let score = true;
  if (leading === "DERISK" || leading === "DEPLOY") {
    const backers = subs.filter((s) => s.choice === leading);
    const avg = backers.reduce((t, s) => t + s.score, 0) / Math.max(backers.length, 1);
    score = Math.floor(avg) >= cfg.minActionScore;
  }
  const passed = quorum && share && score;
  const guardianRequired = passed && leading === "ESCALATE";
  const approved: Fork | null = !passed ? "NO_ACTION" : guardianRequired ? null : leading;

  return { support, total, leading, gates: { quorum, share, score }, passed, guardianRequired, approved };
}
