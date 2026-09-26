import type { Fork, Hex } from "@/lib/types/protocol";
import type { ModelAnswer } from "@/lib/validation/model-output";
import { hashText } from "./canonical";
import type { JevQuestion } from "./questions";
import { computeScore, type Rating } from "./score";

/**
 * Jev decision primitives (JEV_INTEGRATION.md §3–6): Choice, Score, Probability, Reason.
 * Every answer — to any question — is a complete Jev decision.
 */

export interface JevDecision {
  choice: Fork;
  score: number; // 0..10000, computed by computeScore
  probability: number; // bps, 100..9900
  reason: string;
}

export interface FactorRating {
  factor: string;
  rating: Rating;
  evidence: string[];
}

export interface JevAnswer extends JevDecision {
  decisionId: string; // uint256 as decimal string
  agentId: number;
  questionId: number;
  reasonHash: Hex;
  factors: FactorRating[];
}

/** Turn a validated model answer into a Jev answer. The score is computed here, never taken from the model. */
export function toJevAnswer(
  decisionId: string,
  agentId: number,
  question: JevQuestion,
  answer: ModelAnswer,
): JevAnswer {
  const ratings = Object.fromEntries(answer.factors.map((f) => [f.factor, f.rating])) as Record<string, Rating>;
  const reason = answer.reason.trim();
  return {
    decisionId,
    agentId,
    questionId: question.id,
    choice: answer.choice,
    score: computeScore(question.rubric, ratings),
    probability: answer.probability,
    reason,
    reasonHash: hashText(reason),
    factors: answer.factors.map((f) => ({ factor: f.factor, rating: f.rating, evidence: [...f.evidence] })),
  };
}
