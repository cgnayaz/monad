import type { Fork, SettlementResult } from "@/lib/types/protocol";
import type { Settlement, SettlementLine } from "@/lib/model/accountability";
import type { AgentId, Choice, DecisionId, Probability, Wei } from "@/lib/model/primitives";

/**
 * TypeScript mirror of OutcomeRegistry settlement (CONTRACT_SPEC.md §10).
 * Deterministic integer math; agents have no input. Used for previews and tests only.
 */

export interface SettlementParticipant {
  agentId: AgentId;
  bond: Wei;
  submission: { choice: Choice; probability: Probability } | null;
}

export interface SettlementParams {
  slashBps: number;
  missPenaltyBps: number;
  roundReward: Wei;
}

function line(decisionId: DecisionId, x: SettlementParticipant, result: SettlementResult, penalty: Wei): SettlementLine {
  return { decisionId, agentId: x.agentId, bond: x.bond, settlementStatus: "SETTLED", result, reward: 0n, penalty, net: -penalty };
}

export function settle(
  decisionId: DecisionId,
  participants: readonly SettlementParticipant[],
  correctFork: Exclude<Fork, "ESCALATE">,
  p: SettlementParams,
): Settlement {
  const lines = participants.map((x) => {
    if (!x.submission) return line(decisionId, x, "MISSED", (x.bond * BigInt(p.missPenaltyBps)) / 10_000n);
    if (x.submission.choice === "ESCALATE") return line(decisionId, x, "NEUTRAL", 0n);
    if (x.submission.choice === correctFork) return line(decisionId, x, "CORRECT", 0n);
    return line(decisionId, x, "WRONG", (x.bond * BigInt(p.slashBps) * BigInt(x.submission.probability)) / 100_000_000n);
  });

  const pool = lines.reduce((t, l) => t + l.penalty, 0n) + p.roundReward;
  const probOf = (id: AgentId) => BigInt(participants.find((x) => x.agentId === id)!.submission!.probability);
  const correct = lines.filter((l) => l.result === "CORRECT");
  const sumP = correct.reduce((t, l) => t + probOf(l.agentId), 0n);

  let distributed = 0n;
  if (sumP > 0n) {
    for (const l of correct) {
      l.reward = (pool * probOf(l.agentId)) / sumP;
      l.net = l.reward;
      distributed += l.reward;
    }
  }
  return { decisionId, settlementStatus: "SETTLED", lines, roundReward: p.roundReward, toRewardPool: pool - distributed, tx: null };
}

/** Cancelled or void decisions: every lock is returned in full, no rewards or penalties. */
export function release(
  decisionId: DecisionId,
  participants: readonly SettlementParticipant[],
  roundReward: Wei,
  status: "RELEASED" | "VOID",
): Settlement {
  return {
    decisionId,
    settlementStatus: status,
    lines: participants.map((x) => ({ decisionId, agentId: x.agentId, bond: x.bond, settlementStatus: status, result: null, reward: 0n, penalty: 0n, net: 0n })),
    roundReward,
    toRewardPool: roundReward,
    tx: null,
  };
}
