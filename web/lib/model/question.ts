import type { AgentKey, Fork, Hex, QuestionKey } from "@/lib/types/protocol";
import type { UnixSeconds } from "./primitives";
import type { StateId } from "./state";

/**
 * Jev Questions (JEV_INTEGRATION.md §2).
 *
 * A template defines a question once; a Question is that template instantiated for one
 * state. Each Question has its own content-derived id, so it stays identifiable on its
 * own, outside any set. `index` is the uint8 used in on-chain Merkle leaves.
 */

export type QuestionId = `qn_${string}`;
export type QuestionCategory = QuestionKey;

export interface RubricFactor {
  factor: string; // stable snake_case id
  description: string;
  weight: number; // positive integer
}

export interface QuestionTemplate {
  index: number; // 0..5
  category: QuestionCategory;
  text: string;
  inputKeys: string[]; // state input key prefixes the question relies on
  rubric: RubricFactor[];
  allowedForks: Fork[];
}

export interface Question extends QuestionTemplate {
  questionId: QuestionId;
  stateId: StateId;
  createdAt: UnixSeconds;
}

export const QUESTIONS_VERSION = "decmarkt.jev.questions/2" as const;

export interface QuestionSet {
  version: typeof QUESTIONS_VERSION;
  rubricVersion: string;
  stateId: StateId;
  createdAt: UnixSeconds;
  questions: Question[]; // sorted by index
  /** Which questions each agent answers (its batch). */
  assignment: Record<AgentKey, QuestionId[]>;
  /** keccak256 of the canonical set without this field — Decision.questionsHash. */
  hash: Hex;
}

export interface QuestionSetRef {
  hash: Hex;
}
