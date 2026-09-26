import type { Hex } from "@/lib/types/protocol";
import {
  STATE_VERSION,
  type StateId,
  type StateInput,
  type StateRecord,
  type StateSource,
  type StateSubject,
} from "@/lib/model/state";
import type { UnixSeconds } from "@/lib/model/primitives";
import { StateBodySchema } from "@/lib/validation/state";
import { hashCanonical } from "./canonical";

/**
 * Jev State construction (JEV_INTEGRATION.md §1). Produces a StateRecord:
 * structured, versioned, traceable per input, and hashed.
 */

export type { StateInput, StateRecord, StateSource, StateSubject } from "@/lib/model/state";

/**
 * Build a StateRecord. Inputs are sorted by key and sources de-duplicated so that the
 * same content always yields the same stateId and hash.
 */
export function buildState(subject: StateSubject, inputs: StateInput[], timestamp: UnixSeconds): StateRecord {
  const sorted = [...inputs].sort((a, b) => a.key.localeCompare(b.key));
  const source = [...new Set(sorted.map((i) => i.source))].sort() as StateSource[];
  const content = { version: STATE_VERSION, source, timestamp, data: { subject, inputs: sorted } };
  const stateId = `st_${hashCanonical(content).slice(2, 18)}` as StateId;
  const body = StateBodySchema.parse({ stateId, ...content });
  return { ...(body as Omit<StateRecord, "hash">), hash: hashCanonical(body) };
}

/** Recompute the hash of a StateRecord from its content (everything except `hash`). */
export function computeStateHash(state: StateRecord): Hex {
  const { hash: _omit, ...body } = state;
  void _omit;
  return hashCanonical(body);
}

export function availableInputs(state: StateRecord): StateInput[] {
  return state.data.inputs.filter((i) => i.status === "ok");
}

/** Helper for collectors: an explicitly unavailable input. Never a placeholder value. */
export function unavailableInput(
  key: string,
  source: StateSource,
  observedAt: UnixSeconds,
  note: string,
  unit?: string,
): StateInput {
  return { key, value: null, unit, source, observedAt, status: "unavailable", note };
}
