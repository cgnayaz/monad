import { FORKS, PROBABILITY_MAX, PROBABILITY_MIN, SCORE_MAX, type Fork } from "@/lib/types/protocol";

/**
 * Jev decision primitives as first-class, branded types (JEV_INTEGRATION.md §3–5).
 *
 * A plain number cannot be used where a Score or Probability is expected; values
 * only enter the model through the parsers below, which enforce the protocol ranges.
 */

/** Choice — one value of the closed fork set. */
export type Choice = Fork;

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

/** Score — deterministic evaluation, integer 0..10000. Never produced by a model directly. */
export type Score = Branded<number, "Score">;

/** Probability — confidence in basis points, integer 100..9900. */
export type Probability = Branded<number, "Probability">;

// Plain range checks rather than a schema library: these parsers run in the browser too
// (the demo recomputes settlement), and they are the only validation the client needs.
function intInRange(v: unknown, min: number, max: number, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${String(v)}`);
  return v;
}

export const toChoice = (v: unknown): Choice => {
  if (typeof v !== "string" || !(FORKS as readonly string[]).includes(v)) throw new RangeError(`Choice must be one of ${FORKS.join(", ")}, got ${String(v)}`);
  return v as Choice;
};
export const toScore = (v: number): Score => intInRange(v, 0, SCORE_MAX, "Score") as Score;
export const toProbability = (v: number): Probability => intInRange(v, PROBABILITY_MIN, PROBABILITY_MAX, "Probability") as Probability;

/** The three primitives every Jev decision carries. */
export interface JevPrimitives {
  choice: Choice;
  score: Score;
  probability: Probability;
}

/** Amount of native MON in wei. */
export type Wei = bigint;
/** Unix time in seconds. */
export type UnixSeconds = number;
/** uint256 decision id from DecisionRegistry, as a decimal string (JSON-safe). */
export type DecisionId = string;
/** Agent id from DecisionRegistry.registerAgent (uint16). */
export type AgentId = number;
