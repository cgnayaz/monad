/**
 * Shared protocol types. These mirror the enums in contracts/src/lib/DecTypes.sol;
 * the numeric order is part of the on-chain encoding and must not change.
 */

export const FORKS = ["NO_ACTION", "DERISK", "DEPLOY", "ESCALATE"] as const;
export type Fork = (typeof FORKS)[number];

export const STATUSES = [
  "NONE",
  "CREATED",
  "OPEN",
  "AGGREGATED",
  "APPROVED",
  "EXECUTED",
  "RESOLVED",
  "CANCELLED",
] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses shown on the lifecycle rail, in order. CANCELLED is a terminal branch. */
export const LIFECYCLE: readonly Status[] = [
  "CREATED",
  "OPEN",
  "AGGREGATED",
  "APPROVED",
  "EXECUTED",
  "RESOLVED",
];

export const AGENT_KEYS = ["RISK", "YIELD", "SECURITY", "MARKET", "HISTORY"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const QUESTION_KEYS = ["ACTION", "RISK", "YIELD", "SECURITY", "MARKET", "HISTORY"] as const;
export type QuestionKey = (typeof QUESTION_KEYS)[number];

export const SETTLEMENT_RESULTS = ["CORRECT", "WRONG", "NEUTRAL", "MISSED"] as const;
export type SettlementResult = (typeof SETTLEMENT_RESULTS)[number];

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** Fixed-point conventions (DATA_MODEL.md §1). */
export const BPS = 10_000;
export const SCORE_MAX = 10_000;
export const PROBABILITY_MIN = 100;
export const PROBABILITY_MAX = 9_900;

export function forkIndex(fork: Fork): number {
  return FORKS.indexOf(fork);
}

export function forkFromIndex(i: number): Fork {
  const f = FORKS[i];
  if (!f) throw new Error(`Unknown fork index ${i}`);
  return f;
}

export function statusFromIndex(i: number): Status {
  const s = STATUSES[i];
  if (!s) throw new Error(`Unknown status index ${i}`);
  return s;
}

/** Value that is either known or explicitly unavailable, with a reason. Never a placeholder. */
export type Availability<T> =
  | { status: "ok"; value: T }
  | { status: "unavailable"; reason: string };

export const ok = <T,>(value: T): Availability<T> => ({ status: "ok", value });
export const unavailable = <T,>(reason: string): Availability<T> => ({ status: "unavailable", reason });
