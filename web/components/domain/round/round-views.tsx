"use client";

import { Hash } from "@/components/ui/hash";
import { KeyValue, Panel } from "@/components/ui/layout";
import { StatusMark, type Tone } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { SupportBars } from "@/components/domain/support-bars";
import { explorer } from "@/lib/chain/monad";
import type { Wire } from "@/lib/engine/wire";
import { formatBps, formatUtc, shortHex } from "@/lib/format";
import { AGENTS } from "@/lib/jev/agents";
import type { AgentFailureKind, AgentRun } from "@/lib/model/decision";
import { PIPELINE_STAGES, type FinalDecision, type PipelineStage, type StageStatus } from "@/lib/model/final-decision";
import type { TxRef } from "@/lib/model/transaction";
import { FORKS } from "@/lib/types/protocol";

export type WRun = Wire<AgentRun>;
export type WDecision = Wire<FinalDecision>;
export type WTx = Wire<TxRef>;
export interface StageState {
  status: StageStatus | "pending";
  detail?: string;
  txs?: WTx[];
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  STATE: "State snapshot",
  QUESTIONS: "Questions",
  COMMIT: "Commit hashes on-chain",
  PARALLEL_DECISIONS: "Parallel decisions",
  SUBMIT: "Bonded submissions",
  AGGREGATION: "Deterministic aggregation",
  ACTION: "Bounded action",
  EXECUTION: "Execution layer",
};

const stageTone: Record<StageState["status"], Tone> = { pending: "neutral", running: "wait", done: "pass", skipped: "neutral", failed: "fail" };

export const FAILURE_LABEL: Record<AgentFailureKind, string> = {
  timeout: "Timeout",
  provider_error: "Provider error",
  invalid_json: "Invalid JSON",
  schema_violation: "Schema violation",
  refusal: "Refused",
  truncated: "Truncated",
};

function TxLinks({ txs }: { txs?: WTx[] }) {
  if (!txs?.length) return null;
  return (
    <span className="flex flex-wrap gap-x-3 font-mono text-[11.5px]">
      {txs.map((t) => (
        <a key={t.hash + t.functionName} href={explorer.tx(t.hash)} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-ink" title={`${t.contract}.${t.functionName}`}>
          {t.functionName} {shortHex(t.hash, 4, 4)}
        </a>
      ))}
    </span>
  );
}

export function StageList({ stages }: { stages: Record<PipelineStage, StageState> }) {
  return (
    <ol>
      {PIPELINE_STAGES.map((s, i) => {
        const st = stages[s];
        return (
          <li key={s} className="grid grid-cols-[28px_1fr] gap-x-3 border-b border-rule px-4 py-2.5 last:border-b-0 sm:grid-cols-[28px_1fr_110px]">
            <span className="font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <p className={st.status === "pending" ? "text-ink-3" : ""}>{STAGE_LABEL[s]}</p>
              {st.detail && <p className="break-words text-[12px] text-ink-2">{st.detail}</p>}
              <TxLinks txs={st.txs} />
            </div>
            <span className="col-start-2 sm:col-start-auto sm:text-right">
              <StatusMark tone={stageTone[st.status]}>{st.status}</StatusMark>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One row per agent. Failed agents are shown with the failure kind, message and details. */
export function AgentResults({ runs, running }: { runs: Record<string, WRun | undefined>; running: boolean }) {
  return (
    <Table caption="Agent decisions">
      <thead>
        <tr>
          <Th>Agent</Th>
          <Th>Status</Th>
          <Th>Choice</Th>
          <Th align="right">Score</Th>
          <Th align="right">Probability</Th>
          <Th>Reason (informational)</Th>
          <Th align="right">Latency</Th>
        </tr>
      </thead>
      <tbody>
        {AGENTS.map((a) => {
          const r = runs[a.key];
          if (!r) {
            return (
              <tr key={a.key}>
                <Td className="whitespace-nowrap font-medium">{a.name}</Td>
                <Td>{running ? <StatusMark tone="wait">evaluating</StatusMark> : <StatusMark tone="neutral">not run</StatusMark>}</Td>
                <Td colSpan={5} className="text-ink-3">—</Td>
              </tr>
            );
          }
          const latency = `${((r.finishedAt - r.startedAt) / 1000).toFixed(1)} s`;
          if (r.status === "failed" && r.failure) {
            return (
              <tr key={a.key} className="bg-[color-mix(in_srgb,var(--fail)_6%,transparent)]">
                <Td className="whitespace-nowrap font-medium">{a.name}</Td>
                <Td>
                  <StatusMark tone="fail">{FAILURE_LABEL[r.failure.kind]}</StatusMark>
                </Td>
                <Td colSpan={4} className="text-[12.5px] text-fail">
                  {r.failure.message}
                  {r.failure.details.length > 0 && (
                    <details className="mt-1 text-ink-2">
                      <summary className="cursor-pointer text-ink">{r.failure.details.length} detail(s)</summary>
                      <ul className="mt-1 list-disc pl-4 font-mono text-[11.5px]">
                        {r.failure.details.slice(0, 12).map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <span className="mt-1 block text-[11.5px] text-ink-3">No decision submitted; settled as MISSED on-chain in live mode.</span>
                </Td>
                <Td align="right" mono>{latency}</Td>
              </tr>
            );
          }
          const f = r.final!;
          const others = r.batch?.decisions.filter((d) => d.questionIndex !== 0) ?? [];
          return (
            <tr key={a.key}>
              <Td className="whitespace-nowrap font-medium">{a.name}</Td>
              <Td>
                <StatusMark tone="pass">ok</StatusMark>
              </Td>
              <Td mono>{f.choice}</Td>
              <Td align="right" mono>{f.score}</Td>
              <Td align="right" mono>{formatBps(f.probability)}</Td>
              <Td className="min-w-[300px] text-[12.5px] text-ink-2">
                {f.reason}
                {others.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-ink">Batch · {others.length + 1} answers</summary>
                    <ul className="mt-1 space-y-1">
                      {others.map((d) => (
                        <li key={d.questionId}>
                          <span className="font-mono text-ink">Q{d.questionIndex}</span> {d.choice} · score {d.score} · {formatBps(d.probability)} — {d.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Td>
              <Td align="right" mono>{latency}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function DecisionSummary({ d }: { d: WDecision }) {
  const g = d.aggregation;
  const gates = d.threshold.gates;
  const ex = d.execution;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <SupportBars support={FORKS.map((f) => BigInt(g.support[f]))} total={BigInt(g.total)} thresholdBps={d.threshold.thresholdBps} />
        <Panel title="Threshold">
          <KeyValue
            rows={[
              { k: "Quorum", v: <Gate ok={gates.quorum}>{`${d.threshold.submissions} of ${d.threshold.quorum} required`}</Gate> },
              {
                k: "Support share",
                v: <Gate ok={gates.share}>{`${d.threshold.supportShareBps === null ? "—" : formatBps(d.threshold.supportShareBps)} vs ${formatBps(d.threshold.thresholdBps)}`}</Gate>,
              },
              {
                k: "Action score",
                v: <Gate ok={gates.score}>{`${d.aggregateScore ?? "—"} vs ${d.threshold.minActionScore} (DERISK / DEPLOY only)`}</Gate>,
              },
              { k: "Result", v: <StatusMark tone={d.threshold.passed ? "pass" : "fail"}>{d.threshold.passed ? "passed" : "not met → NO_ACTION"}</StatusMark> },
            ]}
          />
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Final decision">
          <KeyValue
            rows={[
              { k: "Mode", v: <StatusMark tone={d.mode === "live" ? "accent" : "neutral"}>{d.mode}</StatusMark> },
              { k: "Decision id", v: d.mode === "live" ? <span className="font-mono">#{d.decisionId}</span> : "not committed (preview)" },
              { k: "Selected choice", v: <span className="font-mono">{d.selectedChoice}</span> },
              { k: "Aggregate score", v: <span className="font-mono">{d.aggregateScore ?? "—"}</span> },
              { k: "Aggregate probability", v: <span className="font-mono">{d.aggregateProbability === null ? "—" : formatBps(d.aggregateProbability)}</span> },
              {
                k: "Action",
                v: d.action ? (
                  <span>
                    <span className="font-mono">{d.action.fork}</span> <span className="text-ink-2">· {d.action.definition.alias} · approved by {d.action.approvedBy}</span>
                    <span className="block text-[12px] text-ink-2">{d.action.definition.effect}</span>
                  </span>
                ) : (
                  "awaiting guardian"
                ),
              },
              { k: "Reputation", v: d.reputationSource === "chain" ? "on-chain agent records" : "no records yet (all agents weighted equally)" },
              { k: "State hash", v: <Hash value={d.state.hash} /> },
              { k: "Questions hash", v: <Hash value={d.questions.hash} /> },
            ]}
          />
        </Panel>
        <Panel title="Execution layer">
          {ex.status === "not-submitted" ? (
            <p className="px-4 py-3 text-[13px] text-ink-2">Not submitted — {ex.reason}</p>
          ) : (
            <KeyValue
              rows={[
                { k: "On-chain status", v: <span className="font-mono">{ex.onChainStatus}</span> },
                {
                  k: "Aggregation check",
                  v: ex.aggregationMatchesChain === null ? "pending" : <Gate ok={ex.aggregationMatchesChain}>{ex.aggregationMatchesChain ? "local rules = DecisionEngine" : "mismatch — execution withheld"}</Gate>,
                },
                { k: "Transactions", v: <TxLinks txs={ex.transactions} /> },
                ...(ex.submissionErrors.length ? [{ k: "Submission errors", v: <span className="text-fail">{ex.submissionErrors.map((e) => `agent ${e.agentId}: ${e.message}`).join("; ")}</span> }] : []),
                ...(ex.next ? [{ k: "Next", v: `${ex.next.step}${ex.next.availableAt ? ` after ${formatUtc(ex.next.availableAt)}` : ""} — ${ex.next.reason}` }] : []),
              ]}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Gate({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <StatusMark tone={ok ? "pass" : "fail"}>{ok ? "pass" : "fail"}</StatusMark>
      <span className="font-mono text-[12.5px]">{children}</span>
    </span>
  );
}
