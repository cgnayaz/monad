import { keccak256, stringToHex } from "viem";
import { ProviderError, type DecisionProvider } from "@/lib/ai/provider";
import type { AgentKey } from "@/lib/types/protocol";
import type { AgentFailure, AgentRun, ParallelDecisions } from "@/lib/model/decision";
import type { DecisionId, Wei } from "@/lib/model/primitives";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import { validateModelOutput } from "@/lib/validation/model-output";
import type { AgentSpec } from "./agents";
import { buildDecisionBatch } from "./batch";
import { toAgentDecision } from "./primitives";
import { ACTION_QUESTION_INDEX, assignedQuestions, questionByIndex, relevantInputKeys, RUBRIC_VERSION } from "./questions";
import { sliceState } from "./state";

/**
 * Jev Parallel Decisions (JEV_INTEGRATION.md §7).
 *
 * Every agent evaluates the committed state (the slice relevant to its questions) and its
 * questions in its own provider call, concurrently. No agent sees another's output; one
 * failure does not affect the others; every run — successful or failed — is preserved.
 * Outputs are never merged here: aggregation is deterministic code (lib/decmarkt).
 *
 * This module produces decisions only. It does not sign or send transactions.
 */

export type { AgentRun, ParallelDecisions } from "@/lib/model/decision";

export const DEFAULT_AGENT_TIMEOUT_MS = 60_000;

export interface ParallelInput {
  decisionId: DecisionId;
  state: StateRecord;
  questionSet: QuestionSet;
  agents: readonly AgentSpec[];
  provider: DecisionProvider;
  /** Bond each agent has locked for this decision (Decision.config.lockPerAgent). */
  bond: Wei;
  timeoutMs?: number;
  /** Called as each agent finishes, in completion order. */
  onRun?: (run: AgentRun) => void;
}

function fail(kind: AgentFailure["kind"], message: string, details: string[] = []): AgentFailure {
  return { kind, message, details };
}

async function runAgent(input: ParallelInput, agent: AgentSpec): Promise<AgentRun> {
  const { decisionId, state, questionSet, provider } = input;
  const questions = assignedQuestions(questionSet, agent.key);
  const inputKeys = relevantInputKeys(questions);
  const slice = sliceState(state, inputKeys);
  const startedAt = Date.now();
  const base = {
    decisionId,
    stateId: state.stateId,
    agentId: agent.agentId,
    agentKey: agent.key,
    provider: provider.id,
    rubricVersion: RUBRIC_VERSION,
    inputKeys,
    startedAt,
  };
  const failed = (failure: AgentFailure, model: string | null = null, rawOutputHash: AgentRun["rawOutputHash"] = null): AgentRun => ({
    ...base,
    model,
    rawOutputHash,
    finishedAt: Date.now(),
    status: "failed",
    failure,
    batch: null,
    final: null,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("agent timeout", "TimeoutError")), input.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await provider.evaluate(
        { agent, state: slice, questions, horizonSec: state.data.subject.horizonSec, bandBps: state.data.subject.bandBps },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return failed(fail("timeout", `No response within ${input.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS} ms`));
      if (err instanceof ProviderError) return failed(fail(err.kind, err.message), err.model);
      return failed(fail("provider_error", err instanceof Error ? err.message : "Unknown provider error"));
    }

    const rawOutputHash = keccak256(stringToHex(res.rawText));
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.rawText);
    } catch {
      return failed(fail("invalid_json", "The response is not valid JSON"), res.model, rawOutputHash);
    }
    const v = validateModelOutput(parsed, { state: slice, assigned: questions });
    if (!v.ok) return failed(fail("schema_violation", `${v.errors.length} schema violation(s)`, v.errors), res.model, rawOutputHash);

    const finishedAt = Date.now();
    const ctx = { decisionId, agentId: agent.agentId, bond: input.bond, timestamp: Math.floor(finishedAt / 1000) };
    const decisions = v.answers.map((a) => toAgentDecision(ctx, questionByIndex(questionSet, a.questionIndex), a));
    const batch = buildDecisionBatch(state.stateId, decisions);
    return {
      ...base,
      model: res.model,
      rawOutputHash,
      finishedAt,
      status: "ok",
      failure: null,
      batch,
      final: batch.decisions.find((d) => d.questionIndex === ACTION_QUESTION_INDEX) ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runParallelDecisions(input: ParallelInput): Promise<ParallelDecisions> {
  const keys = input.agents.map((a) => a.key);
  if (new Set(keys).size !== keys.length) throw new Error("Each agent may run only once per decision");
  // All agents start at once; each run captures its own failure, so Promise.all never rejects.
  const runs = await Promise.all(
    input.agents.map(async (a) => {
      const run = await runAgent(input, a);
      input.onRun?.(run);
      return run;
    }),
  );
  return {
    decisionId: input.decisionId,
    stateId: input.state.stateId,
    questionSetHash: input.questionSet.hash,
    runs: Object.fromEntries(runs.map((r) => [r.agentKey, r])) as Record<AgentKey, AgentRun>,
  };
}
