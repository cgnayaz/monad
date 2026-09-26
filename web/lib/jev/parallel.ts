import { keccak256, stringToHex } from "viem";
import type { DecisionProvider } from "@/lib/ai/provider";
import type { AgentKey, Hex } from "@/lib/types/protocol";
import { validateModelOutput } from "@/lib/validation/model-output";
import type { AgentSpec } from "./agents";
import { buildAgentBatch } from "./batch";
import { toJevAnswer, type JevAnswer } from "./primitives";
import { ACTION_QUESTION_ID, questionById, RUBRIC_VERSION, type QuestionSet } from "./questions";
import type { JevState } from "./state";

/**
 * Jev Parallel Decisions (JEV_INTEGRATION.md §7).
 *
 * Every agent evaluates the same state and question set in its own provider call.
 * No agent sees another's output; one failure does not affect the others. Outputs are
 * never merged here — aggregation is on-chain integer math in DecisionEngine.
 *
 * This module produces decisions only. It does not sign or send transactions.
 */

export interface AgentRun {
  decisionId: string;
  agentId: number;
  agentKey: AgentKey;
  provider: string;
  model: string | null;
  rubricVersion: string;
  startedAt: number;
  finishedAt: number;
  rawOutputHash: Hex | null;
  validation: { ok: true } | { ok: false; errors: string[] };
  answers: JevAnswer[];
  answersRoot: Hex | null;
  /** The agent's final decision: its answer to the ACTION question. */
  final: JevAnswer | null;
}

export interface ParallelInput {
  decisionId: string;
  state: JevState;
  questionSet: QuestionSet;
  agents: readonly AgentSpec[];
  provider: DecisionProvider;
  timeoutMs?: number;
}

export async function runParallelDecisions(input: ParallelInput): Promise<AgentRun[]> {
  const { decisionId, state, questionSet, agents, provider } = input;
  const timeoutMs = input.timeoutMs ?? 45_000;

  const runs = agents.map(async (agent): Promise<AgentRun> => {
    const assigned = questionSet.assignment[agent.key];
    const questions = assigned.map((id) => questionById(questionSet, id));
    const startedAt = Date.now();
    const base = {
      decisionId,
      agentId: agent.agentId,
      agentKey: agent.key,
      provider: provider.id,
      rubricVersion: RUBRIC_VERSION,
      startedAt,
    };
    try {
      const res = await provider.evaluate(
        { agent, state, questions, horizonSec: state.subject.horizonSec, bandBps: state.subject.bandBps },
        AbortSignal.timeout(timeoutMs),
      );
      const rawOutputHash = keccak256(stringToHex(res.rawText));
      const v = validateModelOutput(res.output, { state, questionSet, assigned });
      if (!v.ok) {
        return { ...base, model: res.model, finishedAt: Date.now(), rawOutputHash, validation: v, answers: [], answersRoot: null, final: null };
      }
      const answers = v.answers
        .map((a) => toJevAnswer(decisionId, agent.agentId, questionById(questionSet, a.questionId), a))
        .sort((a, b) => a.questionId - b.questionId);
      const batch = buildAgentBatch(answers);
      return {
        ...base,
        model: res.model,
        finishedAt: Date.now(),
        rawOutputHash,
        validation: { ok: true },
        answers,
        answersRoot: batch.answersRoot,
        final: answers.find((a) => a.questionId === ACTION_QUESTION_ID) ?? null,
      };
    } catch (err) {
      return {
        ...base,
        model: null,
        finishedAt: Date.now(),
        rawOutputHash: null,
        validation: { ok: false, errors: [err instanceof Error ? err.message : "provider error"] },
        answers: [],
        answersRoot: null,
        final: null,
      };
    }
  });

  return Promise.all(runs); // each run already captures its own failure
}
