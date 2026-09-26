import type { AgentKey, Fork } from "@/lib/types/protocol";
import { FORKS } from "@/lib/types/protocol";
import type { UnixSeconds } from "@/lib/model/primitives";
import {
  QUESTIONS_VERSION,
  type Question,
  type QuestionId,
  type QuestionSet,
  type QuestionTemplate,
} from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import { hashCanonical } from "./canonical";

/**
 * Jev Questions (JEV_INTEGRATION.md §2).
 *
 * Templates are versioned data; for each state they are instantiated into Questions
 * with their own content-derived ids. Questions are rendered verbatim in the UI and
 * hashed into `questionsHash`; prompts are derived from them, never the other way round.
 */

export type { Question, QuestionId, QuestionSet, QuestionTemplate, RubricFactor } from "@/lib/model/question";

export const RUBRIC_VERSION = "rubric/1" as const;
export const ACTION_QUESTION_INDEX = 0;

const ALL: Fork[] = [...FORKS];

export const QUESTION_TEMPLATES: readonly QuestionTemplate[] = [
  {
    index: 0,
    category: "ACTION",
    text: "Given the state, which bounded action should the vault take for the next horizon?",
    inputKeys: ["market.", "history.", "network.", "vault.", "protocol.", "record."],
    rubric: [
      { factor: "evidence_strength", description: "How strongly the cited inputs support the chosen fork", weight: 3 },
      { factor: "evidence_agreement", description: "How consistently independent inputs point the same way", weight: 2 },
      { factor: "data_completeness", description: "How complete and fresh the inputs relied on are", weight: 1 },
    ],
    allowedForks: ALL,
  },
  {
    index: 1,
    category: "RISK",
    text: "What is the downside risk to the vault's MON value over the horizon?",
    inputKeys: ["market.", "history.", "vault."],
    rubric: [
      { factor: "downside_magnitude", description: "Size of a plausible adverse move relative to the band", weight: 3 },
      { factor: "volatility_regime", description: "Recent realized volatility versus longer history", weight: 2 },
      { factor: "exposure", description: "Share of vault funds in the ACTIVE bucket", weight: 1 },
    ],
    allowedForks: ALL,
  },
  {
    index: 2,
    category: "YIELD",
    text: "What is the expected opportunity of increasing deployed funds over the horizon?",
    inputKeys: ["market.", "history.", "vault."],
    rubric: [
      { factor: "upside_magnitude", description: "Size of a plausible favorable move relative to the band", weight: 3 },
      { factor: "momentum", description: "Direction and persistence of recent price changes", weight: 2 },
      { factor: "capacity", description: "Funds available in RESERVE to deploy", weight: 1 },
    ],
    allowedForks: ALL,
  },
  {
    index: 3,
    category: "SECURITY",
    text: "Are there security or operational concerns (oracle staleness, confidence width, paused contracts, network health)?",
    inputKeys: ["market.", "network.", "protocol."],
    rubric: [
      { factor: "oracle_quality", description: "Freshness and confidence interval of the price feed", weight: 3 },
      { factor: "network_health", description: "Block production and gas conditions on Monad", weight: 2 },
      { factor: "protocol_state", description: "Contract availability, pause flags, parameter sanity", weight: 2 },
    ],
    allowedForks: ALL,
  },
  {
    index: 4,
    category: "MARKET",
    text: "What does current market information suggest about direction over the horizon?",
    inputKeys: ["market."],
    rubric: [
      { factor: "price_vs_ema", description: "Spot price relative to its moving average", weight: 2 },
      { factor: "short_term_change", description: "Most recent price change", weight: 2 },
      { factor: "signal_clarity", description: "Whether the signal exceeds noise given confidence and band", weight: 2 },
    ],
    allowedForks: ALL,
  },
  {
    index: 5,
    category: "HISTORY",
    text: "What do historical prices and past decision outcomes suggest?",
    inputKeys: ["history.", "record."],
    rubric: [
      { factor: "historical_pattern", description: "Consistency of past price behaviour over comparable windows", weight: 2 },
      { factor: "past_outcomes", description: "What previous resolved decisions' correct forks indicate", weight: 2 },
      { factor: "sample_size", description: "How much history is actually available", weight: 1 },
    ],
    allowedForks: ALL,
  },
];

/** Default batch assignment by template index: primary question + ACTION (JEV_INTEGRATION.md §9). */
export const DEFAULT_ASSIGNMENT: Readonly<Record<AgentKey, readonly number[]>> = {
  RISK: [1, 0],
  YIELD: [2, 0],
  SECURITY: [3, 0],
  MARKET: [4, 0],
  HISTORY: [5, 0],
};

/** Content-derived id: the same template on the same state always has the same id. */
export function questionIdFor(stateId: string, t: QuestionTemplate): QuestionId {
  return `qn_${hashCanonical({ stateId, index: t.index, category: t.category, text: t.text }).slice(2, 18)}` as QuestionId;
}

/** Instantiate the question templates for one state. */
export function buildQuestionSet(state: StateRecord, createdAt: UnixSeconds): QuestionSet {
  const questions: Question[] = QUESTION_TEMPLATES.map((t) => ({
    ...t,
    inputKeys: [...t.inputKeys],
    rubric: t.rubric.map((f) => ({ ...f })),
    allowedForks: [...t.allowedForks],
    questionId: questionIdFor(state.stateId, t),
    stateId: state.stateId,
    createdAt,
  }));
  const byIndex = (i: number) => questions.find((q) => q.index === i)!.questionId;
  const assignment = Object.fromEntries(
    Object.entries(DEFAULT_ASSIGNMENT).map(([agent, idx]) => [agent, idx.map(byIndex)]),
  ) as Record<AgentKey, QuestionId[]>;
  const body = { version: QUESTIONS_VERSION, rubricVersion: RUBRIC_VERSION, stateId: state.stateId, createdAt, questions, assignment };
  return { ...body, hash: hashCanonical(body) };
}

export function computeQuestionSetHash(set: QuestionSet) {
  const { hash: _omit, ...body } = set;
  void _omit;
  return hashCanonical(body);
}

export function questionById(set: QuestionSet, id: QuestionId): Question {
  const q = set.questions.find((x) => x.questionId === id);
  if (!q) throw new Error(`Unknown question ${id}`);
  return q;
}

export function questionByIndex(set: QuestionSet, index: number): Question {
  const q = set.questions.find((x) => x.index === index);
  if (!q) throw new Error(`Unknown question index ${index}`);
  return q;
}

export function assignedQuestions(set: QuestionSet, agent: AgentKey): Question[] {
  return set.assignment[agent].map((id) => questionById(set, id));
}
