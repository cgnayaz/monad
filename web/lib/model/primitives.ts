import { z } from "zod";
import { FORKS, PROBABILITY_MAX, PROBABILITY_MIN, SCORE_MAX, type Fork } from "@/lib/types/protocol";

/**
 * Jev decision primitives as first-class, branded types (JEV_INTEGRATION.md §3–5).
 *
 * A plain number cannot be used where a Score or Probability is expected; values
 * only enter the model through the parsers below, which enforce the protocol ranges.
 */

/** Choice — one value of the closed fork set. */
export const ChoiceSchema = z.enum(FORKS);
export type Choice = Fork;

/** Score — deterministic evaluation, integer 0..10000. Never produced by a model directly. */
export const ScoreSchema = z.number().int().min(0).max(SCORE_MAX).brand<"Score">();
export type Score = z.infer<typeof ScoreSchema>;

/** Probability — confidence in basis points, integer 100..9900. */
export const ProbabilitySchema = z.number().int().min(PROBABILITY_MIN).max(PROBABILITY_MAX).brand<"Probability">();
export type Probability = z.infer<typeof ProbabilitySchema>;

export const toChoice = (v: unknown): Choice => ChoiceSchema.parse(v);
export const toScore = (v: number): Score => ScoreSchema.parse(v);
export const toProbability = (v: number): Probability => ProbabilitySchema.parse(v);

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
