import type { Fork } from "@/lib/types/protocol";
import type { Choice, DecisionId, UnixSeconds, Wei } from "./primitives";
import type { OraclePrice } from "./outcome";
import type { TxRef } from "./transaction";

/**
 * Bounded forks and actions (JEV_INTEGRATION.md §8, §10).
 *
 * The executable action space is a finite, compile-time table. An Action can only
 * reference one of its entries; there is no field that could carry calldata, a target
 * address or an amount chosen by an agent.
 */

export type ActionParameter = "actionBps" | "maxMove";

export interface ProtocolAction {
  fork: Fork;
  alias: "NO_ACTION" | "ACTION_A" | "ACTION_B" | "ESCALATE";
  label: string;
  contract: "ExecutionVault";
  entrypoint: "execute";
  /** Admin-set parameters the branch reads; never agent-supplied. */
  parameters: readonly ActionParameter[];
  effect: string;
  /** false → a guardian must pick an executable fork first. */
  executable: boolean;
}

export const ACTION_SPACE: Readonly<Record<Fork, ProtocolAction>> = Object.freeze({
  NO_ACTION: {
    fork: "NO_ACTION",
    alias: "NO_ACTION",
    label: "No action",
    contract: "ExecutionVault",
    entrypoint: "execute",
    parameters: [],
    effect: "Nothing moves. The start price is still recorded so the decision remains verifiable.",
    executable: true,
  },
  DERISK: {
    fork: "DERISK",
    alias: "ACTION_A",
    label: "De-risk",
    contract: "ExecutionVault",
    entrypoint: "execute",
    parameters: ["actionBps", "maxMove"],
    effect: "Move min(actionBps × ACTIVE, maxMove) from ACTIVE to RESERVE.",
    executable: true,
  },
  DEPLOY: {
    fork: "DEPLOY",
    alias: "ACTION_B",
    label: "Deploy",
    contract: "ExecutionVault",
    entrypoint: "execute",
    parameters: ["actionBps", "maxMove"],
    effect: "Move min(actionBps × RESERVE, maxMove) from RESERVE to ACTIVE.",
    executable: true,
  },
  ESCALATE: {
    fork: "ESCALATE",
    alias: "ESCALATE",
    label: "Escalate",
    contract: "ExecutionVault",
    entrypoint: "execute",
    parameters: [],
    effect: "No automatic action. A guardian selects NO_ACTION, DERISK or DEPLOY before a deadline; otherwise NO_ACTION.",
    executable: false,
  },
});

/** The forks allowed for one decision (Decision.allowedForks), fixed before any agent runs. */
export interface ForkSpace {
  allowed: readonly Choice[];
  mask: number;
}

export interface ActionParams {
  actionBps: number;
  maxMove: Wei;
}

export interface Buckets {
  active: Wei;
  reserve: Wei;
}

export interface ActionExecution {
  amountMoved: Wei;
  after: Buckets;
  startPrice: OraclePrice;
  executedAt: UnixSeconds;
  tx: TxRef | null;
}

/**
 * The action authorised for a decision. `fork` must be an executable entry of
 * ACTION_SPACE; `approvedBy` records which rule selected it.
 */
export interface Action {
  decisionId: DecisionId;
  fork: Exclude<Fork, "ESCALATE">;
  definition: ProtocolAction;
  approvedBy: "engine" | "guardian" | "fail-safe" | "guardian-timeout";
  params: ActionParams | null; // null until read from the vault
  execution: ActionExecution | null; // null until EXECUTED
  /** Deliberately impossible: actions never carry calldata. */
  calldata?: never;
}
