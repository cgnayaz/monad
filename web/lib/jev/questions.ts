import type { AgentKey, Fork, Hex, QuestionKey } from "@/lib/types/protocol";
import { FORKS } from "@/lib/types/protocol";
import { hashCanonical } from "./canonical";

/**
 * Jev Questions (JEV_INTEGRATION.md §2).
 *
 * Questions are explicit, versioned data. They are rendered verbatim in the UI and
 * hashed into `questionsHash`; prompts are derived from them, never the other way round.
 */

export const QUESTIONS_SCHEMA = "decmarkt.jev.questions/1" as const;
export const RUBRIC_VERSION = "rubric/1" as const;

export interface RubricFactor {
  factor: string; // stable snake_case id
  description: string;
  weight: number; // positive integer
}

export interface JevQuestion {
  id: number;
  key: QuestionKey;
  text: string;
  inputKeys: string[]; // state input key prefixes this question relies on
  rubric: RubricFactor[];
  allowedForks: Fork[];
}

export interface QuestionSet {
  schema: typeof QUESTIONS_SCHEMA;
  rubricVersion: typeof RUBRIC_VERSION;
  questions: JevQuestion[];
  assignment: Record<AgentKey, number[]>;
}

const ALL: Fork[] = [...FORKS];

export const QUESTIONS: JevQuestion[] = [
  {
    id: 0,
    key: "ACTION",
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
    id: 1,
    key: "RISK",
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
    id: 2,
    key: "YIELD",
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
    id: 3,
    key: "SECURITY",
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
    id: 4,
    key: "MARKET",
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
    id: 5,
    key: "HISTORY",
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

/** Default batch assignment: primary question + ACTION (JEV_INTEGRATION.md §9). */
export const DEFAULT_ASSIGNMENT: Record<AgentKey, number[]> = {
  RISK: [1, 0],
  YIELD: [2, 0],
  SECURITY: [3, 0],
  MARKET: [4, 0],
  HISTORY: [5, 0],
};

export function buildQuestionSet(): { questionSet: QuestionSet; questionsHash: Hex } {
  const questionSet: QuestionSet = {
    schema: QUESTIONS_SCHEMA,
    rubricVersion: RUBRIC_VERSION,
    questions: QUESTIONS,
    assignment: DEFAULT_ASSIGNMENT,
  };
  return { questionSet, questionsHash: hashCanonical(questionSet) };
}

export function questionById(set: QuestionSet, id: number): JevQuestion {
  const q = set.questions.find((x) => x.id === id);
  if (!q) throw new Error(`Unknown question ${id}`);
  return q;
}

export const ACTION_QUESTION_ID = 0;
