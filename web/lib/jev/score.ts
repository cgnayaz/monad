import { SCORE_MAX } from "@/lib/types/protocol";
import type { RubricFactor } from "./questions";

/**
 * Jev Score (JEV_INTEGRATION.md §4).
 *
 * The model never outputs a score. It rates each rubric factor 0–4; the score is a
 * deterministic weighted sum, in integer arithmetic, so anyone can recompute it.
 *
 *   score = round(10000 × Σ(w·r) / (4 × Σw))
 */

export const RATING_MAX = 4;

export type Rating = 0 | 1 | 2 | 3 | 4;

export function computeScore(rubric: readonly RubricFactor[], ratings: Record<string, Rating>): number {
  let num = 0;
  let den = 0;
  for (const f of rubric) {
    const r = ratings[f.factor];
    if (r === undefined) throw new Error(`Missing rating for factor ${f.factor}`);
    num += f.weight * r;
    den += f.weight * RATING_MAX;
  }
  if (den === 0) throw new Error("Rubric has no weight");
  // Integer round-half-up: floor((2·S·num + den) / (2·den))
  return Math.floor((2 * SCORE_MAX * num + den) / (2 * den));
}
