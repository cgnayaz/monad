import type { Fork, SettlementResult } from "@/lib/types/protocol";
import { correctFork, moveBps } from "@/lib/jev/verify";
import type { DecisionProvenance } from "@/lib/model/provenance";
import { finalSubmission } from "@/lib/model/provenance";
import { settle } from "./settlement";

/**
 * Independent reproduction of the outcome and the settlement from on-chain inputs, with the
 * same deterministic rules the contracts use (CONTRACT_SPEC.md §7, §10). The result is
 * compared line by line with what OutcomeRegistry recorded. No model is involved anywhere.
 */

export interface SettlementParamsOnChain {
  slashBps: number;
  missPenaltyBps: number;
}

export interface ReproducedLine {
  agentId: number;
  result: SettlementResult;
  penalty: bigint;
  reward: bigint;
  /** How the numbers follow from the rule, in words and figures. */
  formula: string;
  matches: boolean;
}

export interface Reproduction {
  outcome: { moveBps: bigint; correctFork: Exclude<Fork, "ESCALATE">; matches: boolean } | null;
  lines: ReproducedLine[];
  toRewardPool: bigint;
  matches: boolean;
  mismatches: string[];
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)} %`;
const mon = (wei: bigint) => {
  const s = (Number(wei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} MON`;
};

export function reproduce(p: DecisionProvenance, params: SettlementParamsOnChain): Reproduction | null {
  const o = p.outcome;
  const s = p.settlement;
  if (!o || !s || s.settlementStatus !== "SETTLED" || !o.observedResult) return null;
  const mismatches: string[] = [];
  const d = p.decision;

  const r = o.observedResult;
  const move = moveBps(r.start.price, r.end.price);
  const observed = correctFork(r.start.price, r.end.price, d.config.bandBps);
  const outcomeMatches = move === r.moveBps && observed === r.correctFork && o.success === (observed === o.expectedAction);
  if (!outcomeMatches) mismatches.push("outcome differs from the recomputed price move");

  const lock = d.config.lockPerAgent;
  const participants = d.participants.map((agentId) => {
    const f = finalSubmission(p, agentId);
    return { agentId, bond: lock, submission: f ? { choice: f.choice, probability: f.probability } : null };
  });
  const local = settle(d.decisionId, participants, observed, { ...params, roundReward: d.roundReward });
  const pool = local.lines.reduce((t, l) => t + l.penalty, 0n) + d.roundReward;
  const correctP = participants.filter((x) => x.submission && x.submission.choice === observed).reduce((t, x) => t + x.submission!.probability, 0);

  const lines: ReproducedLine[] = local.lines.map((l) => {
    const onChain = s.lines.find((x) => x.agentId === l.agentId);
    const sub = participants.find((x) => x.agentId === l.agentId)!.submission;
    const matches = !!onChain && onChain.result === l.result && onChain.penalty === l.penalty && onChain.reward === l.reward;
    if (!matches) mismatches.push(`agent ${l.agentId}: on-chain settlement differs from the rule`);
    let formula = "";
    switch (l.result) {
      case "CORRECT":
        formula = `pool ${mon(pool)} × ${sub!.probability} / ${correctP} (probabilities of correct agents)`;
        break;
      case "WRONG":
        formula = `bond ${mon(lock)} × slash ${pct(params.slashBps)} × probability ${pct(sub!.probability)}`;
        break;
      case "MISSED":
        formula = `bond ${mon(lock)} × miss penalty ${pct(params.missPenaltyBps)}`;
        break;
      case "NEUTRAL":
        formula = "ESCALATE is neutral: bond returned, no reward or penalty";
        break;
    }
    return { agentId: l.agentId, result: l.result!, penalty: l.penalty, reward: l.reward, formula, matches };
  });

  return {
    outcome: { moveBps: move, correctFork: observed, matches: outcomeMatches },
    lines,
    toRewardPool: local.toRewardPool,
    matches: mismatches.length === 0,
    mismatches,
  };
}
