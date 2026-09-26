import type { Address, Hex } from "@/lib/types/protocol";
import type { UnixSeconds } from "./primitives";

/**
 * Jev State (JEV_INTEGRATION.md §1).
 *
 *   stateId · version · source · timestamp · data · hash
 *
 * `hash` is keccak256 over the RFC 8785 canonical JSON of every other field; it is the
 * value committed on-chain as Decision.stateHash. `stateId` is derived from the content
 * (excluding id and hash), so identical content always gets the same id.
 */

export const STATE_VERSION = "decmarkt.jev.state/1" as const;

export type StateId = `st_${string}`;
export type StateSource = "pyth-hermes" | "monad-rpc" | "decision-registry" | "execution-vault";
export type InputStatus = "ok" | "unavailable" | "stale";

export interface StateInput {
  key: string;
  value: string | number | null; // null ⇔ status is not "ok"
  unit?: string;
  source: StateSource;
  sourceRef?: string; // block number, Pyth publish time, …
  observedAt: UnixSeconds;
  status: InputStatus;
  note?: string; // why unavailable / stale
}

export interface StateSubject {
  vault: Address | null; // null until ExecutionVault is deployed
  asset: "MON";
  referenceFeed: "MON/USD";
  horizonSec: number;
  bandBps: number;
}

export interface StateData {
  subject: StateSubject;
  inputs: StateInput[]; // sorted by key
}

export interface StateRecord {
  stateId: StateId;
  version: typeof STATE_VERSION;
  /** Every source that contributed at least one input, sorted. */
  source: StateSource[];
  timestamp: UnixSeconds;
  data: StateData;
  hash: Hex;
}

/**
 * The part of a committed state an agent receives: only the inputs its questions use.
 * `stateHash` refers to the full committed state, not to this slice.
 */
export interface StateSlice {
  stateId: StateId;
  stateHash: Hex;
  timestamp: UnixSeconds;
  subject: StateSubject;
  inputs: StateInput[];
}

/** What remains of a state when only the on-chain commitment is known. */
export interface StateRef {
  stateId: StateId | null;
  hash: Hex;
}
