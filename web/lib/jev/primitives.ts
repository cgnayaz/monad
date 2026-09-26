import type { AgentDecision } from "@/lib/model/decision";
import { toProbability, type AgentId, type DecisionId, type UnixSeconds, type Wei } from "@/lib/model/primitives";
import type { Question } from "@/lib/model/question";
import type { ModelAnswer } from "@/lib/validation/model-output";
import { hashText } from "./canonical";
import { computeScore, type Rating } from "./score";

/**
 * Jev decision primitives (JEV_INTEGRATION.md §3–6). Every answer — to any question — is
 * a complete AgentDecision carrying Choice, Score and Probability as typed fields.
 */

export type { AgentDecision, FactorRating } from "@/lib/model/decision";
export type { Choice, JevPrimitives, Probability, Score } from "@/lib/model/primitives";
export { toChoice, toProbability, toScore } from "@/lib/model/primitives";

export interface DecisionContext {
  decisionId: DecisionId;
  agentId: AgentId;
  bond: Wei;
  timestamp: UnixSeconds;
}

/** Turn a validated model answer into an AgentDecision. The score is computed here, never taken from the model. */
export function toAgentDecision(ctx: DecisionContext, question: Question, answer: ModelAnswer): AgentDecision {
  if (answer.questionIndex !== question.index) throw new Error("Answer does not belong to this question");
  const ratings = Object.fromEntries(answer.factors.map((f) => [f.factor, f.rating])) as Record<string, Rating>;
  const reason = answer.reason.trim();
  return {
    agentId: ctx.agentId,
    decisionId: ctx.decisionId,
    questionId: question.questionId,
    questionIndex: question.index,
    choice: answer.choice,
    score: computeScore(question.rubric, ratings),
    probability: toProbability(answer.probability),
    reason,
    reasonHash: hashText(reason),
    factors: answer.factors.map((f) => ({ factor: f.factor, rating: f.rating, evidence: [...f.evidence] })),
    bond: ctx.bond,
    timestamp: ctx.timestamp,
  };
}
