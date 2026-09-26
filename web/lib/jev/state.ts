import type { Address, Hex } from "@/lib/types/protocol";
import { JevStateSchema } from "@/lib/validation/state";
import { hashCanonical } from "./canonical";

/**
 * Jev State (JEV_INTEGRATION.md §1).
 *
 * The complete information available to agents before they decide. Structured,
 * versioned, traceable (each input carries its source) and hashable (JCS + keccak256).
 */

export const STATE_SCHEMA = "decmarkt.jev.state/1" as const;

export type StateSource = "pyth-hermes" | "monad-rpc" | "decision-registry" | "execution-vault";
export type InputStatus = "ok" | "unavailable" | "stale";

export interface StateInput {
  key: string;
  value: string | number | null; // null ⇔ not ok
  unit?: string;
  source: StateSource;
  sourceRef?: string;
  observedAt: number;
  status: InputStatus;
  note?: string;
}

export interface StateSubject {
  vault: Address | null; // null until ExecutionVault is deployed
  asset: "MON";
  referenceFeed: "MON/USD";
  horizonSec: number;
  bandBps: number;
}

export interface JevState {
  schema: typeof STATE_SCHEMA;
  stateId: string;
  subject: StateSubject;
  observedAt: number;
  inputs: StateInput[];
}

export interface CommittedState {
  state: JevState;
  stateHash: Hex;
}

/**
 * Build and hash a state. `stateId` is derived from the hash of the state without the
 * id, so the id itself is reproducible from the content.
 */
export function buildState(subject: StateSubject, inputs: StateInput[], observedAt: number): CommittedState {
  const sorted = [...inputs].sort((a, b) => a.key.localeCompare(b.key));
  const body = { schema: STATE_SCHEMA, subject, observedAt, inputs: sorted };
  const idHash = hashCanonical(body);
  const state: JevState = { ...body, stateId: `st_${idHash.slice(2, 18)}` };
  const parsed = JevStateSchema.parse(state);
  return { state: parsed as JevState, stateHash: hashCanonical(parsed) };
}

export function stateHash(state: JevState): Hex {
  return hashCanonical(state);
}

export function availableInputs(state: JevState): StateInput[] {
  return state.inputs.filter((i) => i.status === "ok");
}

export function inputKeys(state: JevState): Set<string> {
  return new Set(state.inputs.map((i) => i.key));
}

/** Helper for collectors: an explicitly unavailable input. Never a placeholder value. */
export function unavailableInput(
  key: string,
  source: StateSource,
  observedAt: number,
  note: string,
  unit?: string,
): StateInput {
  return { key, value: null, unit, source, observedAt, status: "unavailable", note };
}
