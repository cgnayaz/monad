import { keccak256, stringToHex } from "viem";
import type { DecisionProvider } from "@/lib/ai/provider";
import type { AgentKey } from "@/lib/types/protocol";
import type { AgentRun, ParallelDecisions } from "@/lib/model/decision";
import type { DecisionId, Wei } from "@/lib/model/primitives";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import { validateModelOutput } from "@/lib/validation/model-output";
import type { AgentSpec } from "./agents";
import { buildDecisionBatch } from "./batch";
import { toAgentDecision } from "./primitives";
import { ACTION_QUESTION_INDEX, assignedQuestions, questionByIndex, RUBRIC_VERSION } from "./questions";

/**
 * Jev Parallel Decisions (JEV_INTEGRATION.md §7).
 *
 * Every agent evaluates the same state and question set in its own provider call.
 * No agent sees another's output; one failure does not affect the others. Outputs are
 * never merged here — aggregation is on-chain integer math in DecisionEngine.
 *
 * This module produces decisions only. It does not sign or send transactions.
 */

export type { AgentRun, ParallelDecisions } from "@/lib/model/decision";

export interface ParallelInput {
  decisionId: DecisionId;
  state: StateRecord;
  questionSet: QuestionSet;
  agents: readonly AgentSpec[];
  provider: DecisionProvider;
  /** Bond each agent has locked for this decision (Decision.config.lockPerAgent). */
  bond: Wei;
  timeoutMs?: number;
}

async function runAgent(input: ParallelInput, agent: AgentSpec): Promise<AgentRun> {
  const { decisionId, state, questionSet, provider } = input;
  const questions = assignedQuestions(questionSet, agent.key);
  const startedAt = Date.now();
  const base = {
    decisionId,
    stateId: state.stateId,
    agentId: agent.agentId,
    agentKey: agent.key,
    provider: provider.id,
    rubricVersion: RUBRIC_VERSION,
    startedAt,
  };
  const failed = (errors: string[], extra: Partial<AgentRun> = {}): AgentRun => ({
    ...base,
    model: null,
    rawOutputHash: null,
    ...extra,
    finishedAt: Date.now(),
    validation: { ok: false, errors },
    batch: null,
    final: null,
  });

  try {
    const res = await provider.evaluate(
      { agent, state, questions, horizonSec: state.data.subject.horizonSec, bandBps: state.data.subject.bandBps },
      AbortSignal.timeout(input.timeoutMs ?? 45_000),
    );
    const rawOutputHash = keccak256(stringToHex(res.rawText));
    const v = validateModelOutput(res.output, { state, assigned: questions });
    if (!v.ok) return failed(v.errors, { model: res.model, rawOutputHash });

    const finishedAt = Date.now();
    const ctx = { decisionId, agentId: agent.agentId, bond: input.bond, timestamp: Math.floor(finishedAt / 1000) };
    const decisions = v.answers.map((a) => toAgentDecision(ctx, questionByIndex(questionSet, a.questionIndex), a));
    const batch = buildDecisionBatch(state.stateId, decisions);
    return {
      ...base,
      model: res.model,
      rawOutputHash,
      finishedAt,
      validation: { ok: true },
      batch,
      final: batch.decisions.find((d) => d.questionIndex === ACTION_QUESTION_INDEX) ?? null,
    };
  } catch (err) {
    return failed([err instanceof Error ? err.message : "provider error"]);
  }
}

export async function runParallelDecisions(input: ParallelInput): Promise<ParallelDecisions> {
  const keys = input.agents.map((a) => a.key);
  if (new Set(keys).size !== keys.length) throw new Error("Each agent may run only once per decision");
  const runs = await Promise.all(input.agents.map((a) => runAgent(input, a))); // each run captures its own failure
  return {
    decisionId: input.decisionId,
    stateId: input.state.stateId,
    questionSetHash: input.questionSet.hash,
    runs: Object.fromEntries(runs.map((r) => [r.agentKey, r])) as Record<AgentKey, AgentRun>,
  };
}
