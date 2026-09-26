import type { Wire } from "@/lib/engine/wire";
import { formatPrice, formatUtc } from "@/lib/format";
import { AGENT_TR, FORK_TR, agentName, questionText } from "@/lib/i18n";
import { AGENTS, isRole, specOf } from "@/lib/jev/agents";
import type { IntegrityCheck } from "@/lib/jev/verify";
import { ACTION_SPACE } from "@/lib/model/action";
import type { SettlementStatus } from "@/lib/model/accountability";
import { AGENT_FAILURE_KINDS, type AgentFailureKind, type AgentRun } from "@/lib/model/decision";
import type { ExecutionHandoff, FinalDecision, PipelineStage, StageStatus } from "@/lib/model/final-decision";
import { finalSubmission, isFullQuestionSet, isFullState, type DecisionProvenance } from "@/lib/model/provenance";
import type { Reproduction, SettlementParamsOnChain } from "@/lib/decmarkt/reproduce";
import type { QuestionSet } from "@/lib/model/question";
import type { StateInput, StateRecord } from "@/lib/model/state";
import type { TxRef } from "@/lib/model/transaction";
import { FORKS, type Fork, type Hex, type Status } from "@/lib/types/protocol";

/**
 * One presentation model for a decision, whatever its source:
 *   - "chain":   a decision read from the contracts, with payloads attached only if verified
 *   - "browser": a round run from this browser (simulation or live), from the pipeline stream
 * Everything is JSON-safe (wei and prices as decimal strings). Nothing here invents a value:
 * unknown fields are null and the components say why.
 */

export type JevStageKey = "STATE" | "QUESTIONS" | "PARALLEL" | "PRIMITIVES" | "ACTION" | "VERIFY";
export type JevStageState = "done" | "active" | "pending" | "failed" | "na";

export interface JevStage {
  key: JevStageKey;
  label: string;
  state: JevStageState;
  primary: string;
  secondary?: string;
}

export interface TxView {
  hash: Hex;
  functionName: string;
  contract: string;
  blockNumber: string | null;
}

export type AgentStatus = "pending" | "processing" | "ok" | "failed" | "missed";

export interface AgentModuleView {
  agentId: number;
  key: string;
  name: string;
  domain: string;
  mandate: string;
  status: AgentStatus;
  failure: { kind: AgentFailureKind; label: string; message: string; details: string[] } | null;
  choice: Fork | null;
  score: number | null;
  probability: number | null;
  reason: string | null; // null when only the hash is known
  reasonHash: Hex | null;
  bond: string | null; // wei
  latencyMs: number | null;
  model: string | null;
  answers: { questionIndex: number; category: string; choice: Fork; score: number; probability: number; reason: string | null }[];
  tx: TxView | null;
}

export interface QuestionItem {
  questionId: string;
  index: number;
  category: string;
  text: string;
  inputs: number;
  availableInputs: number;
  answeredBy: string[];
}

export interface DecisionView {
  source: "chain" | "browser";
  mode: "live" | "simulation";
  decisionId: string | null;
  status: Status | "SIMULATION" | "RUNNING";
  createdAt: number | null;
  stages: JevStage[];
  state: {
    stateId: string | null;
    hash: Hex | null;
    timestamp: number | null;
    sources: string[];
    inputs: StateInput[] | null;
    available: number | null;
    total: number | null;
  };
  questions: { hash: Hex | null; items: QuestionItem[] | null };
  agents: AgentModuleView[];
  aggregation: {
    support: { fork: Fork; value: string }[];
    total: string;
    leading: Fork;
    supportShareBps: number | null;
    aggregateScore: number | null;
    aggregateProbability: number | null;
    passed: boolean;
    gates: { quorum: boolean; share: boolean; score: boolean } | null;
    guardianRequired: boolean;
    submissions: number;
  } | null;
  threshold: { thresholdBps: number; quorum: number; minActionScore: number };
  action: { fork: Fork; alias: string; label: string; effect: string; approvedBy: string } | null;
  execution: {
    status: "not-submitted" | "awaiting" | "executed" | "none";
    detail: string;
    amountMoved: string | null;
    after: { active: string; reserve: string } | null;
    startPrice: string | null;
    txs: TxView[];
    next: { step: string; availableAt: number | null; reason: string } | null;
    executedAt: number | null;
  };
  outcome: {
    status: "verified" | "void" | "pending" | "na";
    detail: string;
    expectedAction: Fork | null;
    observed: Fork | null;
    success: boolean | null;
    moveBps: string | null;
    startPrice: string | null;
    endPrice: string | null;
    source: string | null;
    resolvedAt: number | null;
    /** When the outcome can be verified (executedAt + horizon). */
    availableAt: number | null;
    bandBps: number | null;
  };
  settlement: {
    status: SettlementStatus | "na";
    detail: string;
    lines: {
      agentId: number;
      name: string;
      /** What the agent predicted (its final decision); null = none submitted. */
      choice: Fork | null;
      score: number | null;
      probability: number | null;
      /** What actually happened (the fork the observed move made correct). */
      observed: Fork | null;
      result: string | null;
      bond: string;
      penalty: string;
      reward: string;
      net: string;
      /** bond − penalty + reward: what the agent gets back from this decision. */
      returned: string;
      /** The deterministic rule behind the numbers, when reproduced. */
      formula: string | null;
      reproduced: boolean | null;
    }[];
    /** Outcome and settlement recomputed from on-chain inputs and compared with the contract. */
    reproduction: { matches: boolean; outcomeMatches: boolean; mismatches: string[]; params: { slashBps: number; missPenaltyBps: number } } | null;
  };
  transitions: { status: Status; blockNumber: string; tx: TxView | null }[];
  integrity: { label: string; status: "VERIFIED" | "MISMATCH" | "UNAVAILABLE"; onChain: Hex | null }[];
  payloads: string | null;
}

const FAILURE_LABEL: Record<AgentFailureKind, string> = {
  timeout: "Zaman aşımı",
  provider_error: "Sağlayıcı hatası",
  invalid_json: "Geçersiz JSON",
  schema_violation: "Şema ihlali",
  refusal: "Reddedildi",
  truncated: "Kesildi",
};

export const DOMAIN_LABEL: Record<string, string> = {
  RISK: "Aşağı yönlü risk",
  YIELD: "Fırsat",
  SECURITY: "Operasyonel güvenlik",
  MARKET: "Piyasa sinyali",
  HISTORY: "Geçmiş kayıt",
};

const tx = (t: Wire<TxRef> | TxRef | null | undefined): TxView | null =>
  t ? { hash: t.hash, functionName: t.functionName, contract: t.contract, blockNumber: t.blockNumber === null || t.blockNumber === undefined ? null : String(t.blockNumber) } : null;

function questionItems(set: Wire<QuestionSet> | QuestionSet): QuestionItem[] {
  return set.questions.map((q) => ({
    questionId: q.questionId,
    index: q.index,
    category: q.category,
    text: questionText(q.category, q.text),
    inputs: q.inputs?.length ?? 0,
    availableInputs: q.availableInputs ?? 0,
    answeredBy: AGENTS.filter((a) => set.assignment[a.key]?.includes(q.questionId)).map((a) => agentName(a.key, a.name)),
  }));
}

function stateBlock(s: Wire<StateRecord> | StateRecord | null, hash: Hex | null): DecisionView["state"] {
  if (!s) return { stateId: null, hash, timestamp: null, sources: [], inputs: null, available: null, total: null };
  const inputs = s.data.inputs as StateInput[];
  return {
    stateId: s.stateId,
    hash: s.hash,
    timestamp: s.timestamp,
    sources: [...s.source],
    inputs,
    available: inputs.filter((i) => i.status === "ok").length,
    total: inputs.length,
  };
}

function agentFromRun(spec: (typeof AGENTS)[number], run: Wire<AgentRun> | AgentRun, categoryOf: (i: number) => string): AgentModuleView {
  const base = baseAgent(spec);
  const latencyMs = run.finishedAt - run.startedAt;
  if (run.status === "failed" && run.failure) {
    const kind = AGENT_FAILURE_KINDS.includes(run.failure.kind) ? run.failure.kind : "provider_error";
    return { ...base, status: "failed", latencyMs, model: run.model, failure: { kind, label: FAILURE_LABEL[kind], message: run.failure.message, details: run.failure.details } };
  }
  const f = run.final;
  return {
    ...base,
    status: "ok",
    latencyMs,
    model: run.model,
    choice: f?.choice ?? null,
    score: f?.score ?? null,
    probability: f?.probability ?? null,
    reason: f?.reason ?? null,
    reasonHash: f?.reasonHash ?? null,
    bond: f ? String(f.bond) : null,
    answers: (run.batch?.decisions ?? [])
      .filter((d) => d.questionIndex !== 0)
      .map((d) => ({ questionIndex: d.questionIndex, category: categoryOf(d.questionIndex), choice: d.choice, score: d.score, probability: d.probability, reason: d.reason })),
  };
}

function baseAgent(spec: (typeof AGENTS)[number]): AgentModuleView {
  return {
    agentId: spec.agentId,
    key: spec.key,
    name: agentName(spec.key, spec.name),
    domain: DOMAIN_LABEL[spec.key],
    mandate: AGENT_TR[spec.key]?.mandate ?? spec.mandate,
    status: "pending",
    failure: null,
    choice: null,
    score: null,
    probability: null,
    reason: null,
    reasonHash: null,
    bond: null,
    latencyMs: null,
    model: null,
    answers: [],
    tx: null,
  };
}

function actionBlock(a: { fork: Fork; approvedBy: string } | null | undefined): DecisionView["action"] {
  if (!a) return null;
  const def = ACTION_SPACE[a.fork];
  return { fork: a.fork, alias: def.alias, label: FORK_TR[a.fork].label, effect: FORK_TR[a.fork].effect, approvedBy: a.approvedBy };
}

function stages(v: Omit<DecisionView, "stages">, running: Partial<Record<PipelineStage, StageStatus>> = {}): JevStage[] {
  const ok = v.agents.filter((a) => a.status === "ok").length;
  const failed = v.agents.filter((a) => a.status === "failed" || a.status === "missed").length;
  const processing = v.agents.some((a) => a.status === "processing");
  const g = v.aggregation;
  const pct = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(1)} %`);
  return [
    {
      key: "STATE",
      label: "Durum",
      state: v.state.hash ? "done" : running.STATE === "running" ? "active" : "pending",
      primary: v.state.stateId ?? (v.state.hash ? `${v.state.hash.slice(0, 10)}…` : "—"),
      secondary: v.state.total !== null ? `${v.state.available}/${v.state.total} girdi mevcut` : v.state.hash ? "hash zincire işlendi" : undefined,
    },
    {
      key: "QUESTIONS",
      label: "Sorular",
      state: v.questions.items || v.questions.hash ? "done" : running.QUESTIONS === "running" ? "active" : "pending",
      primary: v.questions.items ? `${v.questions.items.length} soru` : v.questions.hash ? "hash işlendi" : "—",
      secondary: v.questions.hash ? `${v.questions.hash.slice(0, 10)}…` : undefined,
    },
    {
      key: "PARALLEL",
      label: "Paralel kararlar",
      state: processing ? "active" : ok + failed === 0 ? "pending" : failed > 0 && ok === 0 ? "failed" : "done",
      primary: ok + failed === 0 ? (processing ? "ajanlar değerlendiriyor" : "—") : `${ok}/${v.agents.length} geçerli`,
      secondary: failed > 0 ? `${failed} başarısız veya kaçırıldı` : processing ? `${v.agents.filter((a) => a.status === "processing").length} devam ediyor` : undefined,
    },
    {
      key: "PRIMITIVES",
      label: "Seçim · Skor · Olasılık",
      state: g ? "done" : running.AGGREGATION === "running" ? "active" : "pending",
      primary: g ? g.leading : "—",
      secondary: g ? `skor ${g.aggregateScore ?? "—"} · p ${pct(g.aggregateProbability)} · pay ${pct(g.supportShareBps)}` : undefined,
    },
    {
      key: "ACTION",
      label: "Sınırlı eylem",
      state: v.action ? "done" : g?.guardianRequired ? "active" : "pending",
      primary: v.action ? v.action.fork : g?.guardianRequired ? "guardian bekleniyor" : "—",
      secondary: v.action ? `${v.action.alias} · ${v.action.approvedBy}` : g ? `eşik ${g.passed ? "geçti" : "sağlanmadı"}` : undefined,
    },
    {
      key: "VERIFY",
      label: "Doğrulama",
      state: v.outcome.status === "verified" || v.outcome.status === "void" ? "done" : v.outcome.status === "na" ? "na" : v.execution.status === "executed" ? "active" : "pending",
      primary:
        v.outcome.status === "verified"
          ? `${v.outcome.observed} · ${v.outcome.success ? "başarılı" : "isabetsiz"}`
          : v.outcome.status === "void"
            ? "geçersiz"
            : v.outcome.status === "na"
              ? "uygulanamaz"
              : v.execution.status === "executed"
                ? "ufuktan sonra"
                : "—",
      secondary: v.outcome.detail,
    },
  ];
}

// ─── From a browser round (final result or in progress) ─────────────────────

export interface RoundProgress {
  state: Wire<StateRecord> | null;
  questions: Wire<QuestionSet> | null;
  runs: Partial<Record<string, Wire<AgentRun>>>;
  running: Partial<Record<PipelineStage, StageStatus>>;
  submissions: Record<number, Wire<TxRef> | null>;
  decision: Wire<FinalDecision> | null;
}

export function fromRound(p: RoundProgress): DecisionView {
  const d = p.decision;
  const state = d?.state ?? p.state;
  const questions = d?.questions ?? p.questions;
  const categoryOf = (i: number) => questions?.questions.find((q) => q.index === i)?.category ?? `Q${i}`;
  const agentsRunning = p.running.PARALLEL_DECISIONS === "running";

  const liveRound = d ? d.mode === "live" : p.running.COMMIT === "done";
  const agents = AGENTS.map((role) => {
    const run = d?.parallel.runs[role.key] ?? p.runs[role.key];
    // The on-chain id this round used for the role (re-registered operators have new ids).
    const subKey = Object.keys(p.submissions).find((k) => isRole(Number(k), role));
    const spec = { ...role, agentId: run?.agentId ?? (subKey !== undefined ? Number(subKey) : role.agentId) };
    const view = run ? agentFromRun(spec, run, categoryOf) : { ...baseAgent(spec), status: (agentsRunning ? "processing" : "pending") as AgentStatus };
    const sub = p.submissions[spec.agentId];
    // A bond exists only when the decision was opened on-chain.
    return { ...view, bond: liveRound ? view.bond : null, tx: sub ? tx(sub) : view.tx };
  });

  const g = d?.aggregation;
  const ex: Wire<ExecutionHandoff> | null = d?.execution ?? null;
  const live = d ? d.mode === "live" : false;

  const base: Omit<DecisionView, "stages"> = {
    source: "browser",
    mode: d?.mode ?? "simulation",
    decisionId: d && d.mode === "live" ? d.decisionId : null,
    status: d ? (ex?.status === "submitted" ? ex.onChainStatus : "SIMULATION") : "RUNNING",
    createdAt: d?.createdAt ?? null,
    state: stateBlock(state, state?.hash ?? null),
    questions: { hash: questions?.hash ?? null, items: questions ? questionItems(questions) : null },
    agents,
    aggregation: g
      ? {
          support: FORKS.map((f) => ({ fork: f, value: g.support[f] })),
          total: g.total,
          leading: g.leading,
          supportShareBps: g.supportShareBps,
          aggregateScore: g.aggregateScore,
          aggregateProbability: g.aggregateProbability,
          passed: g.passed,
          gates: g.gates,
          guardianRequired: g.guardianRequired,
          submissions: g.submissions,
        }
      : null,
    threshold: {
      thresholdBps: d?.parameters.thresholdBps ?? 6000,
      quorum: d?.parameters.quorum ?? 4,
      minActionScore: d?.parameters.minActionScore ?? 5500,
    },
    action: actionBlock(d?.action),
    execution: !ex
      ? { status: "none", detail: "—", amountMoved: null, after: null, startPrice: null, txs: [], next: null, executedAt: null }
      : ex.status === "not-submitted"
        ? { status: "not-submitted", detail: ex.reason, amountMoved: null, after: null, startPrice: null, txs: [], next: null, executedAt: null }
        : {
            status: ex.onChainStatus === "EXECUTED" ? "executed" : "awaiting",
            detail: ex.next ? `${ex.next.step}: ${ex.next.reason}` : ex.onChainStatus,
            amountMoved: null,
            after: null,
            startPrice: null,
            txs: ex.transactions.map((t) => tx(t)!),
            next: ex.next,
            executedAt: null,
          },
    outcome: live
      ? {
          status: "pending",
          detail: ex?.status === "submitted" && ex.next?.step === "resolve" && ex.next.availableAt ? `doğrulanabilir: ${formatUtc(ex.next.availableAt)} sonrası` : "yürütme ve ufuktan sonra",
          expectedAction: null,
          observed: null,
          success: null,
          moveBps: null,
          startPrice: null,
          endPrice: null,
          source: null,
          resolvedAt: null,
          availableAt: ex?.status === "submitted" && ex.next?.step === "resolve" ? ex.next.availableAt : null,
          bandBps: d?.parameters.bandBps ?? null,
        }
      : { status: "na", detail: d ? "simülasyon: hiçbir işlem gönderilmez" : "—", expectedAction: null, observed: null, success: null, moveBps: null, startPrice: null, endPrice: null, source: null, resolvedAt: null, availableAt: null, bandBps: null },
    settlement: live
      ? { status: "LOCKED", detail: "teminatlar sonuç doğrulanana kadar kilitli", lines: [], reproduction: null }
      : { status: "na", detail: d ? "simülasyonda teminat yok" : "—", lines: [], reproduction: null },
    transitions: [],
    integrity: [],
    payloads: d?.payloads.detail ?? null,
  };
  return { ...base, stages: stages(base, p.running) };
}

// ─── From the chain ─────────────────────────────────────────────────────────

export function fromProvenance(
  p: DecisionProvenance,
  integrity: IntegrityCheck[] = [],
  repro: { reproduction: Reproduction | null; params: SettlementParamsOnChain } | null = null,
): DecisionView {
  const d = p.decision;
  const state = isFullState(p.state) ? p.state : null;
  const questions = isFullQuestionSet(p.questions) ? p.questions : null;
  const categoryOf = (i: number) => questions?.questions.find((q) => q.index === i)?.category ?? `Q${i}`;
  const txAt = (s: Status) => tx(d.transitions.find((t) => t.status === s)?.tx);
  const pastOpen = !["CREATED", "OPEN"].includes(d.status);

  const agents: AgentModuleView[] = d.participants.map((id) => ({ ...specOf(id), agentId: id })).map((spec) => {
    const run = p.parallel ? Object.values(p.parallel.runs).find((r) => r.agentId === spec.agentId) : undefined;
    const sub = finalSubmission(p, spec.agentId);
    if (!sub) {
      const missed: AgentModuleView = { ...baseAgent(spec), status: pastOpen ? "missed" : "pending", bond: String(d.config.lockPerAgent) };
      // The verified run payload says why no decision was submitted.
      if (run?.status === "failed" && run.failure) {
        const f = agentFromRun(spec, run, categoryOf);
        return { ...missed, failure: f.failure, latencyMs: f.latencyMs, model: f.model };
      }
      return missed;
    }
    const fromRun = run ? agentFromRun(spec, run, categoryOf) : null;
    const others = p.submissions.filter((s) => s.agentId === spec.agentId && s.questionIndex !== 0);
    return {
      ...baseAgent(spec),
      status: "ok",
      choice: sub.choice,
      score: sub.score,
      probability: sub.probability,
      reason: fromRun?.reason ?? null,
      reasonHash: sub.reasonHash,
      bond: String(sub.bond),
      latencyMs: fromRun?.latencyMs ?? null,
      model: fromRun?.model ?? null,
      answers: others.map((s) => ({
        questionIndex: s.questionIndex,
        category: categoryOf(s.questionIndex),
        choice: s.choice,
        score: s.score,
        probability: s.probability,
        reason: run?.batch?.decisions.find((x) => x.questionIndex === s.questionIndex)?.reason ?? null,
      })),
    };
  });

  const g = p.aggregation;
  const e = p.action?.execution ?? null;
  const o = p.outcome;
  const expo = e?.startPrice.expo ?? -8;

  const base: Omit<DecisionView, "stages"> = {
    source: "chain",
    mode: "live",
    decisionId: d.decisionId,
    status: d.status,
    createdAt: d.createdAt,
    state: stateBlock(state, d.stateHash),
    questions: { hash: d.questionsHash, items: questions ? questionItems(questions) : null },
    agents,
    aggregation: g
      ? {
          support: FORKS.map((f) => ({ fork: f, value: String(g.support[f]) })),
          total: String(g.total),
          leading: g.leading,
          supportShareBps: g.supportShareBps,
          aggregateScore: g.aggregateScore,
          aggregateProbability: g.aggregateProbability,
          passed: g.passed,
          gates: g.gates,
          guardianRequired: g.guardianRequired,
          submissions: g.submissions,
        }
      : null,
    threshold: { thresholdBps: d.config.thresholdBps, quorum: d.config.quorum, minActionScore: d.config.minActionScore },
    action: actionBlock(p.action),
    execution: e
      ? {
          status: "executed",
          detail: `${p.action!.fork} yürütüldü`,
          amountMoved: String(e.amountMoved),
          after: { active: String(e.after.active), reserve: String(e.after.reserve) },
          startPrice: formatPrice(e.startPrice.price, e.startPrice.expo),
          txs: e.tx ? [tx(e.tx)!] : [],
          next: null,
          executedAt: e.executedAt,
        }
      : {
          status: d.status === "CANCELLED" ? "none" : "awaiting",
          detail: d.status === "CANCELLED" ? "yürütmeden önce iptal edildi" : p.action ? "onaylandı; yürütme bekleniyor" : "onay bekleniyor",
          amountMoved: null,
          after: null,
          startPrice: null,
          txs: [],
          next: null,
          executedAt: null,
        },
    outcome: o
      ? {
          status: o.status === "VOID" ? "void" : "verified",
          detail: o.status === "VOID" ? "pencere içinde geçerli oracle güncellemesi yok; teminatlar iade edildi" : `hareket ${o.observedResult?.moveBps} bps, bant ±${d.config.bandBps}`,
          expectedAction: o.expectedAction,
          observed: o.observedResult?.correctFork ?? null,
          success: o.success,
          moveBps: o.observedResult ? String(o.observedResult.moveBps) : null,
          startPrice: o.observedResult ? formatPrice(o.observedResult.start.price, expo) : null,
          endPrice: o.observedResult ? formatPrice(o.observedResult.end.price, expo) : null,
          availableAt: e ? e.executedAt + d.config.horizon : null,
          bandBps: d.config.bandBps,
          source:
            o.verificationSource.kind === "pyth"
              ? `Pyth ${o.verificationSource.contract} · feed ${o.verificationSource.feedId.slice(0, 10)}… · yayın penceresi ${formatUtc(o.verificationSource.window.from)} + ${o.verificationSource.window.to - o.verificationSource.window.from} s`
              : "simülasyon",
          resolvedAt: o.timestamp,
        }
      : {
          status: d.status === "CANCELLED" ? "na" : "pending",
          detail: d.status === "CANCELLED" ? "iptal edildi" : e ? `doğrulanabilir: ${formatUtc(e.executedAt + d.config.horizon)} sonrası` : "yürütmeden sonra",
          expectedAction: null,
          observed: null,
          success: null,
          moveBps: null,
          startPrice: null,
          endPrice: null,
          source: null,
          resolvedAt: null,
          availableAt: e ? e.executedAt + d.config.horizon : null,
          bandBps: d.config.bandBps,
        },
    settlement: p.settlement
      ? {
          status: p.settlement.settlementStatus,
          detail:
            p.settlement.settlementStatus === "SETTLED"
              ? "ödüller ve cezalar uygulandı"
              : p.settlement.settlementStatus === "LOCKED"
                ? "teminatlar sonuç doğrulanana kadar kilitli"
                : p.settlement.settlementStatus === "RELEASED"
                  ? "iptal edildi; teminatlar tamamen iade edildi"
                  : p.settlement.settlementStatus === "VOID"
                    ? "sonuç geçersiz; teminatlar tamamen iade edildi"
                    : "teminatlar henüz kilitlenmedi",
          lines: p.settlement.lines.map((l) => {
            const f = finalSubmission(p, l.agentId);
            const rl = repro?.reproduction?.lines.find((x) => x.agentId === l.agentId);
            return {
              agentId: l.agentId,
              name: agentName(specOf(l.agentId).key, `Ajan ${l.agentId}`),
              choice: f?.choice ?? null,
              score: f?.score ?? null,
              probability: f?.probability ?? null,
              observed: o?.observedResult?.correctFork ?? null,
              result: l.result,
              bond: String(l.bond),
              penalty: String(l.penalty),
              reward: String(l.reward),
              net: String(l.net),
              returned: String(l.bond - l.penalty + l.reward),
              formula: rl?.formula ?? null,
              reproduced: rl ? rl.matches : null,
            };
          }),
          reproduction: repro?.reproduction
            ? { matches: repro.reproduction.matches, outcomeMatches: !!repro.reproduction.outcome?.matches, mismatches: repro.reproduction.mismatches, params: repro.params }
            : null,
        }
      : { status: "na", detail: "—", lines: [], reproduction: null },
    transitions: d.transitions.map((t) => ({ status: t.status, blockNumber: String(t.blockNumber), tx: tx(t.tx) })),
    integrity: integrity.map((c) => ({ label: c.label, status: c.status, onChain: c.onChain })),
    payloads: null,
  };
  // Execution tx is also the EXECUTED transition; make sure it is linked even if the vault read had none.
  if (base.execution.status === "executed" && base.execution.txs.length === 0) {
    const t = txAt("EXECUTED");
    if (t) base.execution.txs.push(t);
  }
  return { ...base, stages: stages(base) };
}
