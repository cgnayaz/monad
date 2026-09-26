import type { DecisionProvider } from "@/lib/ai/provider";
import { aggregate } from "@/lib/decmarkt/aggregate";
import { resolveAction } from "@/lib/jev/action";
import type { AgentSpec } from "@/lib/jev/agents";
import { forkSpace } from "@/lib/jev/forks";
import { runParallelDecisions } from "@/lib/jev/parallel";
import { buildQuestionSet } from "@/lib/jev/questions";
import type { Action } from "@/lib/model/action";
import type { Aggregation } from "@/lib/model/aggregation";
import type { AgentRun } from "@/lib/model/decision";
import {
  PREVIEW_DECISION_ID,
  type AgentOutcome,
  type DecisionParameters,
  type ExecutionHandoff,
  type FinalDecision,
  type PipelineEvent,
  type PipelineStage,
  type StageStatus,
} from "@/lib/model/final-decision";
import type { DecisionId, UnixSeconds } from "@/lib/model/primitives";
import type { StateRecord } from "@/lib/model/state";
import type { TxRef } from "@/lib/model/transaction";
import { FORKS, type Status } from "@/lib/types/protocol";
import type { ExecutionLayer, ReputationRecords } from "./ports";

/**
 * The Jev decision pipeline (JEV_INTEGRATION.md §12).
 *
 *   STATE → QUESTIONS → [COMMIT] → PARALLEL DECISIONS → CHOICE · SCORE · PROBABILITY
 *         → [SUBMIT] → AGGREGATION → BOUNDED ACTION → [EXECUTION] → (VERIFY later)
 *
 * Bracketed stages run only when an execution layer is available ("live"); otherwise the
 * pipeline runs in "preview" mode on the same real state with the same real agents and
 * writes nothing on-chain. At no point does a model choose the final decision: aggregation,
 * threshold and action are the deterministic functions in lib/decmarkt and lib/jev.
 */

export interface PipelineDeps {
  collectState: () => Promise<StateRecord>;
  provider: DecisionProvider;
  agents: readonly AgentSpec[];
  params: DecisionParameters;
  reputation: ReputationRecords;
  /** null → preview mode; `previewReason` says why. */
  execution: ExecutionLayer | null;
  previewReason?: string;
  agentTimeoutMs?: number;
  now?: () => UnixSeconds;
}

export type Emit = (e: PipelineEvent) => void;

export async function runDecisionPipeline(deps: PipelineDeps, emit: Emit = () => {}): Promise<FinalDecision> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const stage = (s: PipelineStage, status: StageStatus, detail?: string, txs?: TxRef[]) =>
    emit({ type: "stage", stage: s, status, ...(detail ? { detail } : {}), ...(txs ? { txs } : {}) });
  const exec = deps.execution;
  const p = deps.params;
  const space = forkSpace(p.allowedForks);

  // STATE ────────────────────────────────────────────────────────────────
  stage("STATE", "running");
  const state = await deps.collectState();
  emit({ type: "state", state });
  stage("STATE", "done", `${state.data.inputs.filter((i) => i.status === "ok").length}/${state.data.inputs.length} inputs available`);

  // QUESTIONS ────────────────────────────────────────────────────────────
  stage("QUESTIONS", "running");
  const questions = buildQuestionSet(state, now());
  emit({ type: "questions", questions });
  stage("QUESTIONS", "done", `${questions.questions.length} questions`);

  // COMMIT (live): hashes on-chain before any agent runs ────────────────
  let decisionId: DecisionId = PREVIEW_DECISION_ID;
  let participants: number[] = deps.agents.map((a) => a.agentId);
  let deadline: UnixSeconds | null = null;
  const txs: TxRef[] = [];
  if (exec) {
    stage("COMMIT", "running");
    try {
      const c = await exec.commit(state, questions, p);
      decisionId = c.decisionId;
      participants = c.participants;
      deadline = c.deadline;
      txs.push(...c.txs);
      stage("COMMIT", "done", `decision #${decisionId} open until ${deadline}`, c.txs);
    } catch (err) {
      stage("COMMIT", "failed", errMessage(err));
      throw new Error(`Commit failed: ${errMessage(err)}`);
    }
  } else {
    stage("COMMIT", "skipped", deps.previewReason ?? "preview mode");
  }

  // PARALLEL DECISIONS ─────────────────────────────────────────────────
  stage("PARALLEL_DECISIONS", "running", `${deps.agents.length} agents`);
  const parallel = await runParallelDecisions({
    decisionId,
    state,
    questionSet: questions,
    agents: deps.agents.filter((a) => participants.includes(a.agentId)),
    provider: deps.provider,
    bond: p.lockPerAgent,
    timeoutMs: deps.agentTimeoutMs,
    onRun: (run) => emit({ type: "agent", run }),
  });
  const runs = Object.values(parallel.runs);
  const okRuns = runs.filter((r): r is AgentRun & { final: NonNullable<AgentRun["final"]> } => r.status === "ok" && r.final !== null);
  stage("PARALLEL_DECISIONS", okRuns.length === runs.length ? "done" : "failed", `${okRuns.length}/${runs.length} agents produced a valid decision`);

  // SUBMIT (live): each agent's batch from its own operator key ────────
  let counted = okRuns;
  const submissionErrors: { agentId: number; message: string }[] = [];
  if (exec) {
    stage("SUBMIT", "running");
    const results = await Promise.all(
      okRuns.map(async (r) => {
        const agent = deps.agents.find((a) => a.agentId === r.agentId)!;
        try {
          const tx = await exec.submitBatch(decisionId, agent, r.batch!);
          emit({ type: "submission", agentId: r.agentId, tx, error: null });
          txs.push(tx);
          return r;
        } catch (err) {
          submissionErrors.push({ agentId: r.agentId, message: errMessage(err) });
          emit({ type: "submission", agentId: r.agentId, tx: null, error: errMessage(err) });
          return null;
        }
      }),
    );
    counted = results.filter((r): r is (typeof okRuns)[number] => r !== null);
    stage("SUBMIT", submissionErrors.length ? "failed" : "done", `${counted.length} batches on-chain`);
  } else {
    stage("SUBMIT", "skipped", "preview mode");
  }

  // AGGREGATION: deterministic, never delegated to a model ─────────────
  stage("AGGREGATION", "running");
  const aggregation: Aggregation = aggregate(
    decisionId,
    counted.map((r) => ({
      agentId: r.agentId,
      choice: r.final.choice,
      score: r.final.score,
      probability: r.final.probability,
      agentSubmitted: deps.reputation.records[r.agentId]?.submitted ?? 0,
      agentCorrect: deps.reputation.records[r.agentId]?.correct ?? 0,
    })),
    { thresholdBps: p.thresholdBps, minActionScore: p.minActionScore, quorum: p.quorum },
  );
  stage("AGGREGATION", "done", `leading ${aggregation.leading}, threshold ${aggregation.passed ? "passed" : "not met"}`);

  // BOUNDED ACTION ─────────────────────────────────────────────────────
  const action: Action | null = resolveAction(aggregation);
  if (action && !space.allowed.includes(action.fork)) throw new Error(`Action ${action.fork} outside the allowed fork space`);
  stage("ACTION", "done", action ? `${action.fork} (${action.approvedBy})` : "awaiting guardian");

  // EXECUTION LAYER HANDOFF ────────────────────────────────────────────
  let execution: ExecutionHandoff;
  if (!exec) {
    execution = { status: "not-submitted", reason: deps.previewReason ?? "preview mode" };
    stage("EXECUTION", "skipped", execution.reason);
  } else {
    stage("EXECUTION", "running");
    execution = await handOff(exec, { decisionId, participants, counted: counted.length, deadline, aggregation, action, txs, submissionErrors, horizon: p.horizon, now });
    stage("EXECUTION", execution.status === "submitted" && execution.next?.step !== "execute" ? "done" : "failed", describe(execution));
  }

  const agents: AgentOutcome[] = runs.map((r) =>
    r.status === "ok" && r.final
      ? { agentId: r.agentId, agentKey: r.agentKey, status: "ok", final: r.final }
      : { agentId: r.agentId, agentKey: r.agentKey, status: "failed", failure: r.failure! },
  );

  const decision: FinalDecision = {
    version: "decmarkt.final-decision/1",
    mode: exec ? "live" : "preview",
    decisionId,
    createdAt: now(),
    parameters: p,
    state,
    questions,
    parallel,
    agentDecisions: runs.flatMap((r) => r.batch?.decisions ?? []),
    agents,
    aggregation,
    aggregateScore: aggregation.aggregateScore,
    aggregateProbability: aggregation.aggregateProbability,
    selectedChoice: aggregation.leading,
    threshold: {
      thresholdBps: p.thresholdBps,
      supportShareBps: aggregation.supportShareBps,
      quorum: p.quorum,
      submissions: aggregation.submissions,
      minActionScore: p.minActionScore,
      gates: aggregation.gates ?? { quorum: false, share: false, score: false },
      passed: aggregation.passed,
    },
    action,
    execution,
    reputationSource: deps.reputation.source,
  };
  emit({ type: "result", decision });
  return decision;
}

async function handOff(
  exec: ExecutionLayer,
  ctx: {
    decisionId: DecisionId;
    participants: number[];
    counted: number;
    deadline: UnixSeconds | null;
    aggregation: Aggregation;
    action: Action | null;
    txs: TxRef[];
    submissionErrors: { agentId: number; message: string }[];
    horizon: number;
    now: () => UnixSeconds;
  },
): Promise<ExecutionHandoff> {
  const base = { status: "submitted" as const, decisionId: ctx.decisionId, transactions: ctx.txs, submissionErrors: ctx.submissionErrors };

  // DecisionEngine only aggregates early when every participant has submitted.
  if (ctx.counted < ctx.participants.length) {
    return {
      ...base,
      onChainStatus: "OPEN",
      aggregationMatchesChain: null,
      next: { step: "aggregate", availableAt: ctx.deadline === null ? null : ctx.deadline + 1, reason: "not every participant submitted; aggregation opens after the deadline" },
    };
  }

  let status: Status;
  try {
    const r = await exec.aggregate(ctx.decisionId);
    ctx.txs.push(r.tx);
    status = r.status;
  } catch (err) {
    return { ...base, onChainStatus: "OPEN", aggregationMatchesChain: null, next: { step: "aggregate", availableAt: null, reason: errMessage(err) } };
  }
  if (status === "CANCELLED") {
    return { ...base, onChainStatus: status, aggregationMatchesChain: null, next: null };
  }

  const onChain = await exec.readAggregation(ctx.decisionId);
  const matches =
    FORKS.every((f) => onChain.support[f] === ctx.aggregation.support[f]) &&
    onChain.leading === ctx.aggregation.leading &&
    onChain.passed === ctx.aggregation.passed &&
    onChain.guardianRequired === ctx.aggregation.guardianRequired &&
    onChain.approved === ctx.aggregation.approved;

  if (status === "AGGREGATED") {
    return { ...base, onChainStatus: status, aggregationMatchesChain: matches, next: { step: "guardian", availableAt: null, reason: "agents escalated; a guardian must choose a bounded action" } };
  }
  if (!ctx.action) {
    return { ...base, onChainStatus: status, aggregationMatchesChain: matches, next: { step: "guardian", availableAt: null, reason: "no action approved yet" } };
  }
  if (!matches) {
    // Never execute on a disagreement between the local rules and the contract.
    return { ...base, onChainStatus: status, aggregationMatchesChain: false, next: { step: "investigate", availableAt: null, reason: "local aggregation differs from DecisionEngine; execution withheld" } };
  }

  try {
    const r = await exec.execute(ctx.decisionId, ctx.action);
    ctx.txs.push(r.tx);
    return { ...base, onChainStatus: "EXECUTED", aggregationMatchesChain: true, next: { step: "resolve", availableAt: r.executedAt + ctx.horizon, reason: "outcome is verified after the horizon" } };
  } catch (err) {
    return { ...base, onChainStatus: status, aggregationMatchesChain: true, next: { step: "execute", availableAt: null, reason: errMessage(err) } };
  }
}

function describe(e: ExecutionHandoff): string {
  if (e.status === "not-submitted") return e.reason;
  return e.next ? `${e.onChainStatus}; next: ${e.next.step} — ${e.next.reason}` : e.onChainStatus;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0];
  return "unknown error";
}
