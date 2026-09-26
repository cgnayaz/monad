import type { Address, AgentKey, Hex, Status } from "@/lib/types/protocol";
import type { Settlement } from "./accountability";
import type { Action } from "./action";
import type { Aggregation } from "./aggregation";
import type { AgentDecision, ParallelDecisions, SubmissionRecord } from "./decision";
import type { Outcome } from "./outcome";
import type { AgentId, DecisionId, UnixSeconds, Wei } from "./primitives";
import type { QuestionSet, QuestionSetRef } from "./question";
import type { StateRecord, StateRef } from "./state";
import type { LifecycleTransition, TxRef } from "./transaction";

/**
 * Provenance (DATA_MODEL.md §6).
 *
 *   State → Question → Agent → Decision → Aggregation → Action → Transaction → Outcome → Settlement
 *
 * A DecisionProvenance holds every link. On-chain commitments are always present;
 * off-chain payloads (full state, questions, reasons) are present once they have been
 * loaded and their hashes checked, otherwise only the reference is kept.
 */

export interface AgentRef {
  agentId: AgentId;
  key: AgentKey;
  name: string;
  operator: Address | null; // null until registered on-chain
}

export interface DecisionConfig {
  submissionWindow: number;
  horizon: number;
  bandBps: number;
  thresholdBps: number;
  minActionScore: number;
  quorum: number;
  allowedForks: number;
  lockPerAgent: Wei;
}

/** The decision as recorded in DecisionRegistry. */
export interface DecisionRecord {
  decisionId: DecisionId;
  status: Status;
  stateHash: Hex;
  questionsHash: Hex;
  proposer: Address;
  config: DecisionConfig;
  createdAt: UnixSeconds;
  openedAt: UnixSeconds | null;
  deadline: UnixSeconds | null;
  participants: AgentId[];
  roundReward: Wei;
  transitions: LifecycleTransition[];
}

export interface DecisionProvenance {
  decision: DecisionRecord;
  state: StateRecord | StateRef;
  questions: QuestionSet | QuestionSetRef;
  agents: AgentRef[];
  /** Final decisions as submitted on-chain, one per participant that submitted. */
  submissions: SubmissionRecord[];
  /** Every agent's full batch, when the off-chain payloads are available. */
  parallel: ParallelDecisions | null;
  aggregation: Aggregation | null;
  action: Action | null;
  outcome: Outcome | null;
  settlement: Settlement | null;
}

export const isFullState = (s: StateRecord | StateRef): s is StateRecord => "data" in s;
export const isFullQuestionSet = (q: QuestionSet | QuestionSetRef): q is QuestionSet => "questions" in q;

// ─── Trace ──────────────────────────────────────────────────────────────────

export const PROVENANCE_STAGES = [
  "STATE",
  "QUESTION",
  "AGENT",
  "DECISION",
  "AGGREGATION",
  "ACTION",
  "TRANSACTION",
  "OUTCOME",
  "SETTLEMENT",
] as const;
export type ProvenanceStage = (typeof PROVENANCE_STAGES)[number];

export interface ProvenanceStep {
  stage: ProvenanceStage;
  status: "present" | "reference-only" | "pending";
  ref: string; // human-readable identifier
  hash?: Hex;
  tx?: TxRef | null;
}

function txFor(p: DecisionProvenance, status: Status): TxRef | null {
  return p.decision.transitions.find((t) => t.status === status)?.tx ?? null;
}

/**
 * Reconstruct the chain for one agent's final decision. Every step names what links it
 * to the previous one (ids and hashes), or says it is still pending.
 */
export function traceDecision(p: DecisionProvenance, agentId: AgentId): ProvenanceStep[] {
  const agent = p.agents.find((a) => a.agentId === agentId);
  const submission = p.submissions.find((s) => s.agentId === agentId);
  const run = p.parallel ? Object.values(p.parallel.runs).find((r) => r.agentId === agentId) : undefined;
  const final: AgentDecision | null = run?.final ?? null;
  const question = isFullQuestionSet(p.questions) && final ? p.questions.questions.find((q) => q.questionId === final.questionId) : undefined;
  const contribution = p.aggregation?.inputs.find((i) => i.agentId === agentId);
  const line = p.settlement?.lines.find((l) => l.agentId === agentId);

  return [
    {
      stage: "STATE",
      status: isFullState(p.state) ? "present" : "reference-only",
      ref: p.state.stateId ?? "state",
      hash: p.decision.stateHash,
      tx: txFor(p, "CREATED"),
    },
    {
      stage: "QUESTION",
      status: question ? "present" : "reference-only",
      ref: question ? `${question.questionId} [${question.category}]` : "ACTION question",
      hash: p.decision.questionsHash,
    },
    {
      stage: "AGENT",
      status: agent ? "present" : "pending",
      ref: agent ? `${agent.name} (#${agent.agentId})${agent.operator ? ` ${agent.operator}` : ""}` : `agent #${agentId}`,
    },
    {
      stage: "DECISION",
      status: submission ? "present" : "pending",
      ref: submission
        ? `${submission.choice} · score ${submission.score} · p ${submission.probability}`
        : "no submission",
      hash: submission?.answersRoot,
    },
    {
      stage: "AGGREGATION",
      status: p.aggregation ? "present" : "pending",
      ref: p.aggregation
        ? `leading ${p.aggregation.leading}, ${p.aggregation.passed ? "passed" : "not passed"}${contribution ? `, weight ${contribution.weight}` : ""}`
        : "not aggregated",
      tx: txFor(p, "AGGREGATED"),
    },
    {
      stage: "ACTION",
      status: p.action ? "present" : "pending",
      ref: p.action ? `${p.action.fork} (${p.action.approvedBy})` : "not approved",
      tx: txFor(p, "APPROVED"),
    },
    {
      stage: "TRANSACTION",
      status: p.action?.execution ? "present" : "pending",
      ref: p.action?.execution?.tx?.hash ?? "not executed",
      tx: txFor(p, "EXECUTED"),
    },
    {
      stage: "OUTCOME",
      status: p.outcome ? "present" : "pending",
      ref: p.outcome
        ? p.outcome.status === "VOID"
          ? "void"
          : `correct ${p.outcome.observedResult?.correctFork}, success ${p.outcome.success}`
        : "not resolved",
      tx: txFor(p, "RESOLVED"),
    },
    {
      stage: "SETTLEMENT",
      status: line && line.settlementStatus === "SETTLED" ? "present" : "pending",
      ref: line ? `${line.result ?? line.settlementStatus} · reward ${line.reward} · penalty ${line.penalty}` : "not settled",
      tx: p.settlement?.tx ?? null,
    },
  ];
}

// ─── Consistency ────────────────────────────────────────────────────────────

/**
 * Check that every link in the chain agrees with its neighbours. Returns a list of
 * violations; an empty list means the provenance is internally consistent.
 */
export function validateProvenance(p: DecisionProvenance): string[] {
  const issues: string[] = [];
  const id = p.decision.decisionId;

  if (p.state.hash.toLowerCase() !== p.decision.stateHash.toLowerCase()) issues.push("state hash differs from Decision.stateHash");
  if (p.questions.hash.toLowerCase() !== p.decision.questionsHash.toLowerCase()) issues.push("question set hash differs from Decision.questionsHash");

  if (isFullState(p.state) && isFullQuestionSet(p.questions)) {
    if (p.questions.stateId !== p.state.stateId) issues.push("question set belongs to a different state");
    for (const q of p.questions.questions) if (q.stateId !== p.state.stateId) issues.push(`${q.questionId} belongs to a different state`);
  }

  const participants = new Set(p.decision.participants);
  for (const s of p.submissions) {
    if (s.decisionId !== id) issues.push(`submission of agent ${s.agentId} references decision ${s.decisionId}`);
    if (!participants.has(s.agentId)) issues.push(`agent ${s.agentId} submitted without being a participant`);
  }

  if (p.parallel) {
    if (p.parallel.decisionId !== id) issues.push("parallel run set references another decision");
    for (const run of Object.values(p.parallel.runs)) {
      const onChain = p.submissions.find((s) => s.agentId === run.agentId);
      if (!run.batch || !run.final) continue;
      for (const d of run.batch.decisions) {
        if (d.decisionId !== id || d.agentId !== run.agentId) issues.push(`batch ${run.batch.batchId} contains a foreign decision`);
        if (isFullQuestionSet(p.questions) && !p.questions.questions.some((q) => q.questionId === d.questionId)) {
          issues.push(`decision on unknown question ${d.questionId}`);
        }
      }
      if (onChain) {
        if (onChain.answersRoot.toLowerCase() !== run.batch.answersRoot.toLowerCase()) issues.push(`agent ${run.agentId}: answersRoot differs from chain`);
        if (onChain.choice !== run.final.choice || onChain.score !== run.final.score || onChain.probability !== run.final.probability) {
          issues.push(`agent ${run.agentId}: final decision differs from chain`);
        }
      }
    }
  }

  if (p.aggregation) {
    if (p.aggregation.submissions !== p.submissions.length) issues.push("aggregation submission count differs from submissions");
    for (const i of p.aggregation.inputs) {
      const s = p.submissions.find((x) => x.agentId === i.agentId);
      if (!s || s.choice !== i.choice) issues.push(`aggregation input for agent ${i.agentId} does not match its submission`);
    }
  }

  if (p.action) {
    if (!p.aggregation) issues.push("action without aggregation");
    else if (p.aggregation.approved !== null && p.aggregation.approved !== p.action.fork) issues.push("action differs from approved fork");
    if (p.action.definition.fork !== p.action.fork) issues.push("action definition does not match its fork");
  }

  if (p.outcome) {
    if (!p.action?.execution) issues.push("outcome without executed action");
    else if (p.outcome.expectedAction !== p.action.fork) issues.push("outcome expectedAction differs from executed action");
    if (p.outcome.observedResult && p.outcome.success !== (p.outcome.expectedAction === p.outcome.observedResult.correctFork)) {
      issues.push("outcome success flag inconsistent with observed result");
    }
  }

  if (p.settlement) {
    const settled = new Set(p.settlement.lines.map((l) => l.agentId));
    if (settled.size !== participants.size || [...participants].some((a) => !settled.has(a))) issues.push("settlement does not cover exactly the participants");
    if (p.settlement.settlementStatus === "SETTLED" && p.outcome?.status !== "VERIFIED") issues.push("settled without a verified outcome");
  }

  return issues;
}
