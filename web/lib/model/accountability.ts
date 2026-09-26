import type { SettlementResult } from "@/lib/types/protocol";
import type { AgentId, DecisionId, Wei } from "./primitives";
import type { TxRef } from "./transaction";

/**
 * Accountability: bond, reward, penalty, settlement status (CONTRACT_SPEC.md §10).
 *
 * Settlement status of a decision's bonds:
 *   NOT_LOCKED  decision created, bonds not yet locked
 *   LOCKED      bonds locked (OPEN → EXECUTED)
 *   SETTLED     outcome verified, rewards and penalties applied
 *   RELEASED    decision cancelled, locks returned in full
 *   VOID        outcome could not be verified, locks returned in full
 */
export type SettlementStatus = "NOT_LOCKED" | "LOCKED" | "SETTLED" | "RELEASED" | "VOID";

export interface BondPosition {
  decisionId: DecisionId;
  agentId: AgentId;
  bond: Wei;
  settlementStatus: SettlementStatus;
}

export interface SettlementLine extends BondPosition {
  result: SettlementResult | null; // null unless SETTLED
  reward: Wei;
  penalty: Wei;
  /** reward − penalty, signed. */
  net: bigint;
}

export interface Settlement {
  decisionId: DecisionId;
  settlementStatus: SettlementStatus;
  lines: SettlementLine[];
  roundReward: Wei;
  toRewardPool: Wei;
  tx: TxRef | null;
}
