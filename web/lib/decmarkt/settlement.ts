import type { Fork, SettlementResult } from "@/lib/types/protocol";

/**
 * TypeScript mirror of OutcomeRegistry settlement (CONTRACT_SPEC.md §10).
 * Deterministic integer math; agents have no input. Used for previews and tests only.
 */

export interface SettlementParticipant {
  agentId: number;
  lock: bigint;
  submission: { choice: Fork; probability: number } | null;
}

export interface SettlementLine {
  agentId: number;
  result: SettlementResult;
  lockReleased: bigint;
  penalty: bigint;
  reward: bigint;
}

export interface SettlementParams {
  slashBps: number;
  missPenaltyBps: number;
  roundReward: bigint;
}

export function settle(
  participants: readonly SettlementParticipant[],
  correctFork: Fork,
  p: SettlementParams,
): { lines: SettlementLine[]; toRewardPool: bigint } {
  const lines: SettlementLine[] = participants.map((x) => {
    if (!x.submission) {
      return { agentId: x.agentId, result: "MISSED", lockReleased: x.lock, penalty: (x.lock * BigInt(p.missPenaltyBps)) / 10_000n, reward: 0n };
    }
    if (x.submission.choice === "ESCALATE") {
      return { agentId: x.agentId, result: "NEUTRAL", lockReleased: x.lock, penalty: 0n, reward: 0n };
    }
    if (x.submission.choice === correctFork) {
      return { agentId: x.agentId, result: "CORRECT", lockReleased: x.lock, penalty: 0n, reward: 0n };
    }
    const penalty = (x.lock * BigInt(p.slashBps) * BigInt(x.submission.probability)) / 100_000_000n;
    return { agentId: x.agentId, result: "WRONG", lockReleased: x.lock, penalty, reward: 0n };
  });

  const pool = lines.reduce((t, l) => t + l.penalty, 0n) + p.roundReward;
  const correct = lines.filter((l) => l.result === "CORRECT");
  const probOf = (id: number) => BigInt(participants.find((x) => x.agentId === id)!.submission!.probability);
  const sumP = correct.reduce((t, l) => t + probOf(l.agentId), 0n);

  let distributed = 0n;
  if (sumP > 0n) {
    for (const l of correct) {
      l.reward = (pool * probOf(l.agentId)) / sumP;
      distributed += l.reward;
    }
  }
  return { lines, toRewardPool: pool - distributed };
}
