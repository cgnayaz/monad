"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { AgentModules } from "@/components/decision/agent-modules";
import { AggregationPanel, QuestionsPanel, StatePanel } from "@/components/decision/panels";
import { Button } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { formatBps, formatMon, formatPrice, formatUtc, shortHex } from "@/lib/format";
import { AGENTS } from "@/lib/jev/agents";
import { ACTION_SPACE } from "@/lib/model/action";
import type { Settlement } from "@/lib/model/accountability";
import { FORKS } from "@/lib/types/protocol";
import type { DecisionView } from "@/lib/view/decision-view";
import type { ChainTx, DemoMode, VerifyResult } from "./use-demo";

const muted = (s: string) => <span className="text-ink-3">{s}</span>;

/** Re-render on an interval while `active` (for timers that show real elapsed time). */
function useNow(active: boolean, ms = 200) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

// 1 · 2 ─────────────────────────────────────────────────────────────────────

export function StateStep({ v, live, commitTx }: { v: DecisionView; live: boolean; commitTx: ChainTx | undefined }) {
  return (
    <div className="space-y-3">
      <StatePanel v={v} withInputs={false} />
      {v.state.inputs && (
        <details>
          <summary className="cursor-pointer text-[12.5px] text-ink">All {v.state.inputs.length} inputs, with source and status</summary>
          <div className="mt-2">
            <StatePanel v={{ ...v, state: { ...v.state } }} withInputs />
          </div>
        </details>
      )}
      {live && commitTx?.hash && (
        <p className="text-[12.5px] text-ink-2">
          Hash committed on-chain before any agent ran:{" "}
          <a className="font-mono underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.tx(commitTx.hash)} target="_blank" rel="noreferrer">
            createDecision {shortHex(commitTx.hash, 4, 4)}
          </a>
        </p>
      )}
    </div>
  );
}

export function QuestionsStep({ v }: { v: DecisionView }) {
  return <QuestionsPanel v={v} />;
}

// 3 ─────────────────────────────────────────────────────────────────────────

/** Five lanes on one time axis: each bar is that agent's measured evaluation time. */
export function ParallelStep({ v, startedAt }: { v: DecisionView; startedAt: number | null }) {
  const processing = v.agents.some((a) => a.status === "processing");
  const now = useNow(processing);
  const elapsed = (a: DecisionView["agents"][number]) => (a.latencyMs !== null ? a.latencyMs : a.status === "processing" && startedAt ? now - startedAt : null);
  const max = Math.max(1, ...v.agents.map((a) => elapsed(a) ?? 0));
  return (
    <div className="border border-rule bg-surface">
      {v.agents.map((a) => {
        const ms = elapsed(a);
        const failed = a.status === "failed" || a.status === "missed";
        return (
          <div key={a.key} className="grid grid-cols-[minmax(120px,170px)_110px_1fr_56px] items-center gap-3 border-b border-rule px-4 py-2.5 text-[12.5px] last:border-b-0">
            <span className="truncate font-medium">{a.name}</span>
            <span>
              {a.failure ? (
                <StatusMark tone="fail">{a.failure.label}</StatusMark>
              ) : (
                <StatusMark tone={a.status === "ok" ? "pass" : a.status === "processing" ? "wait" : "neutral"} live={a.status === "processing"}>
                  {a.status === "ok" ? "decided" : a.status === "processing" ? "evaluating" : a.status}
                </StatusMark>
              )}
            </span>
            <div className="relative h-1.5 bg-surface-2">
              {ms !== null && <div className={`h-full ${failed ? "bg-fail" : a.status === "ok" ? "bg-ink" : "bg-accent"}`} style={{ width: `${(ms / max) * 100}%` }} />}
            </div>
            <span className="text-right font-mono tabular text-ink-2">{ms !== null ? `${(ms / 1000).toFixed(1)} s` : "—"}</span>
          </div>
        );
      })}
      <p className="px-4 py-2 text-[11.5px] text-ink-3">All five start together; bars share one time axis. No agent sees another&apos;s output.</p>
    </div>
  );
}

// 4 ─────────────────────────────────────────────────────────────────────────

export function PrimitivesStep({ v }: { v: DecisionView }) {
  return <AgentModules agents={v.agents} />;
}

// 5 ─────────────────────────────────────────────────────────────────────────

/** Every question-level decision, and how the ACTION row feeds the aggregation. */
export function BatchStep({ v, decision }: { v: DecisionView; decision: { agentDecisions: { agentId: number; questionIndex: number; choice: string; score: number; probability: number }[] } | null }) {
  const items = v.questions.items ?? [];
  const cell = (agentId: number, q: number) => decision?.agentDecisions.find((d) => d.agentId === agentId && d.questionIndex === q);
  return (
    <div className="space-y-2">
      <Table caption="Question-level decisions">
        <thead>
          <tr>
            <Th>Question</Th>
            {AGENTS.map((a) => (
              <Th key={a.key}>{a.name.replace(" Analyst", "")}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.questionId} className={q.index === 0 ? "bg-surface-2" : ""}>
              <Td className="whitespace-nowrap">
                <span className="font-mono text-ink-3">Q{q.index}</span> <span className="text-[11px] font-medium tracking-[0.06em]">{q.category}</span>
                {q.index === 0 && <span className="block text-[11px] text-accent">final decision → aggregation</span>}
              </Td>
              {AGENTS.map((a) => {
                const d = cell(a.agentId, q.index);
                const assigned = q.answeredBy.includes(a.name);
                return (
                  <Td key={a.key} className="whitespace-nowrap">
                    {d ? (
                      <span className="font-mono text-[12px]">
                        {d.choice}
                        <span className="block text-ink-3">
                          {d.score} · {formatBps(d.probability, 0)}
                        </span>
                      </span>
                    ) : assigned ? (
                      muted("no answer")
                    ) : (
                      <span className="text-ink-3">·</span>
                    )}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-[12px] text-ink-2">
        Each agent answers its own domain question and the action question as one batch. Every answer is a separate record (on-chain in live mode);
        only the Q0 answers are aggregated, the domain answers are the evidence behind them.
      </p>
    </div>
  );
}

// 6 ─────────────────────────────────────────────────────────────────────────

export function ForksStep({ v, allowed }: { v: DecisionView; allowed: string[] }) {
  const counts = Object.fromEntries(FORKS.map((f) => [f, v.agents.filter((a) => a.choice === f).length]));
  return (
    <Table caption="Bounded action space">
      <thead>
        <tr>
          <Th>Fork</Th>
          <Th>Alias</Th>
          <Th>Effect</Th>
          <Th>Allowed</Th>
          <Th align="right">Final choices</Th>
        </tr>
      </thead>
      <tbody>
        {FORKS.map((f) => (
          <tr key={f}>
            <Td mono>{f}</Td>
            <Td mono className="text-ink-2">{ACTION_SPACE[f].alias}</Td>
            <Td className="min-w-[260px] text-ink-2">{ACTION_SPACE[f].effect}</Td>
            <Td>{allowed.includes(f) ? <StatusMark tone="pass">yes</StatusMark> : <StatusMark tone="neutral">no</StatusMark>}</Td>
            <Td align="right" mono>{counts[f]}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// 7 ─────────────────────────────────────────────────────────────────────────

export function AggregationStep({ v }: { v: DecisionView }) {
  const g = v.aggregation;
  const fig = (label: string, value: React.ReactNode, note?: React.ReactNode) => (
    <div className="px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 font-mono text-[20px] leading-7 tabular">{value}</p>
      {note && <p className="text-[12px] text-ink-2">{note}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 border border-rule bg-surface md:grid-cols-4 [&>*]:border-rule max-md:[&>*:nth-child(odd)]:border-r max-md:[&>*:nth-child(n+3)]:border-t md:[&>*:not(:last-child)]:border-r">
        {fig("Selected choice", g ? g.leading : muted("—"), g ? `${g.submissions} final decisions` : undefined)}
        {fig("Aggregate score", g?.aggregateScore ?? muted("—"), "mean score of backers")}
        {fig("Aggregate probability", g?.aggregateProbability != null ? formatBps(g.aggregateProbability, 1) : muted("—"), "mean probability of backers")}
        {fig(
          "Threshold",
          g?.supportShareBps != null ? formatBps(g.supportShareBps, 1) : muted("—"),
          g ? <StatusMark tone={g.passed ? "pass" : "fail"}>{g.passed ? `passed · ≥ ${formatBps(v.threshold.thresholdBps, 0)}` : `not met · ${formatBps(v.threshold.thresholdBps, 0)} required`}</StatusMark> : undefined,
        )}
      </div>
      <AggregationPanel v={v} />
    </div>
  );
}

// 8 ─────────────────────────────────────────────────────────────────────────

export function ActionStep({ v, mode, sim }: { v: DecisionView; mode: DemoMode; sim: { fork: string; start: { price: string; expo: number; publishTime: number } } | null }) {
  const a = v.action;
  if (!a) return <p className="text-[13px] text-ink-3">{v.aggregation?.guardianRequired ? "Agents escalated: a guardian must choose among the bounded forks." : "Waiting for aggregation."}</p>;
  const passed = v.aggregation?.passed;
  return (
    <div className="border border-rule bg-surface px-4 py-3 text-[13px]">
      <p>
        <span className="font-mono text-[15px]">{a.fork}</span> <span className="text-ink-2">· {a.alias}</span>{" "}
        <StatusMark tone={passed ? "pass" : "neutral"}>{passed ? "threshold passed — selected action" : "threshold not met — fail-safe"}</StatusMark>
      </p>
      <p className="mt-1 text-ink-2">{a.effect}</p>
      <p className="mt-1 text-[12px] text-ink-3">
        Approved by {a.approvedBy}. {a.fork === "NO_ACTION" ? "Nothing moves; the start price is still recorded so the outcome can be verified." : "Only this predefined branch of ExecutionVault can run."}
      </p>
      {mode === "simulation" && sim && (
        <p className="mt-2 border-t border-rule pt-2 text-[12.5px] text-ink-2">
          Applied to the local vault model (no funds, no transaction). Start price {formatPrice(BigInt(sim.start.price), sim.start.expo)} USD, published {formatUtc(sim.start.publishTime)}.
        </p>
      )}
      {mode === "live" && v.execution.status === "executed" && (
        <p className="mt-2 border-t border-rule pt-2 font-mono text-[12.5px] text-ink-2">
          moved {v.execution.amountMoved ? formatMon(BigInt(v.execution.amountMoved)) : "0"} MON · start price {v.execution.startPrice} USD
        </p>
      )}
    </div>
  );
}

// 9 ─────────────────────────────────────────────────────────────────────────

export function MonadStep({
  mode,
  txs,
  awaiting,
  onExecute,
}: {
  mode: DemoMode;
  txs: ChainTx[];
  awaiting: boolean;
  onExecute: (via: "wallet" | "keeper") => void;
}) {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  if (mode === "simulation") {
    return (
      <p className="border border-dashed border-rule px-4 py-3 text-[13px] text-ink-2">
        No transactions. Simulation mode never submits anything to Monad; switch to live testnet mode to see the same round committed, executed and
        settled on-chain.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ol className="border border-rule bg-surface">
        {txs.length === 0 && <li className="px-4 py-2.5 text-[12.5px] text-ink-3">No transactions yet.</li>}
        {txs.map((t) => (
          <li key={t.label} className="dm-arrive grid grid-cols-[1fr_auto] gap-3 border-b border-rule px-4 py-2 text-[12.5px] last:border-b-0">
            <div className="min-w-0">
              <p className="font-mono">{t.label}</p>
              {t.detail && <p className={`text-[11.5px] ${t.status === "failed" ? "text-fail" : "text-ink-3"}`}>{t.detail}</p>}
            </div>
            <div className="flex items-center gap-3">
              {t.hash && (
                <a className="font-mono text-[11.5px] underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.tx(t.hash)} target="_blank" rel="noreferrer">
                  {shortHex(t.hash, 4, 4)}
                </a>
              )}
              <StatusMark tone={t.status === "confirmed" ? "pass" : t.status === "failed" ? "fail" : "wait"} live={t.status === "pending"}>
                {t.status}
              </StatusMark>
            </div>
          </li>
        ))}
      </ol>
      {awaiting && (
        <div className="flex flex-wrap items-center gap-3 border border-accent px-4 py-3">
          <p className="min-w-0 flex-1 basis-64 text-[13px]">The action is approved on-chain. Execute it from your wallet — anyone may; the contract decides what runs.</p>
          {!isConnected ? (
            <span className="text-[12.5px] text-ink-2">Connect a wallet (top right) to approve, or</span>
          ) : chainId !== 10143 ? (
            <Button variant="secondary" onClick={() => switchChain({ chainId: 10143 })}>
              Switch to Monad Testnet
            </Button>
          ) : (
            <Button onClick={() => onExecute("wallet")}>Approve in wallet</Button>
          )}
          <Button variant="secondary" onClick={() => onExecute("keeper")}>
            Execute via keeper
          </Button>
        </div>
      )}
    </div>
  );
}

// 10 ────────────────────────────────────────────────────────────────────────

export function Countdown({ label, until, total }: { label: string; until: number; total: number }) {
  const now = useNow(true, 250) / 1000;
  const left = Math.max(0, until - now);
  const pct = total > 0 ? Math.min(100, ((total - left) / total) * 100) : 100;
  return (
    <div className="border border-rule bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span>Waiting for the {label}</span>
        <span className="font-mono tabular">{Math.ceil(left)} s</span>
      </div>
      <div className="mt-2 h-1 bg-surface-2">
        <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function VerifyStep({ r, mode }: { r: VerifyResult | null; mode: DemoMode }) {
  if (!r) return null;
  const row = (label: string, expected: React.ReactNode, observed: React.ReactNode) => (
    <div className="grid grid-cols-[120px_1fr_1fr] gap-3 border-b border-rule px-4 py-2 last:border-b-0">
      <span className="label self-center">{label}</span>
      <span className="font-mono text-[13px]">{expected}</span>
      <span className="font-mono text-[13px]">{observed}</span>
    </div>
  );
  return (
    <div className="border border-rule bg-surface">
      <div className="grid grid-cols-[120px_1fr_1fr] gap-3 border-b border-rule bg-surface-2 px-4 py-2">
        <span />
        <span className="label">Expected</span>
        <span className="label">Observed</span>
      </div>
      {row("Action", r.expected, <span className={r.success ? "text-pass" : "text-fail"}>{r.observed}</span>)}
      {row("Price", `${r.startPrice} USD${r.startTime ? ` · ${formatUtc(r.startTime).slice(11)}` : ""}`, `${r.endPrice} USD${r.endTime ? ` · ${formatUtc(r.endTime).slice(11)}` : ""}`)}
      {row("Move", `band ±${r.bandBps} bps`, `${r.moveBps} bps`)}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <StatusMark tone={r.success ? "pass" : "fail"}>{r.success ? "success — expected equals observed" : "miss — expected differs from observed"}</StatusMark>
        <span className="text-[11.5px] text-ink-3">
          {mode === "live" ? "Recorded by OutcomeRegistry from a signed Pyth price inside the window." : "Observed from the published Pyth price; not verified on-chain in simulation."}
        </span>
      </div>
    </div>
  );
}

// 11 ────────────────────────────────────────────────────────────────────────

export function SettlementStep({ mode, v, sim }: { mode: DemoMode; v: DecisionView; sim: Settlement | null }) {
  const rows =
    mode === "simulation"
      ? (sim?.lines ?? []).map((l) => ({ agentId: l.agentId, result: l.result, bond: l.bond, penalty: l.penalty, reward: l.reward, net: l.net }))
      : v.settlement.lines.map((l) => ({ agentId: l.agentId, result: l.result, bond: BigInt(l.bond), penalty: BigInt(l.penalty), reward: BigInt(l.reward), net: BigInt(l.net) }));
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <Table caption="Settlement">
        <thead>
          <tr>
            <Th>Agent</Th>
            <Th>Prediction</Th>
            <Th>Result</Th>
            <Th align="right">Bond</Th>
            <Th align="right">Reward</Th>
            <Th align="right">Penalty</Th>
            <Th align="right">Net</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const a = v.agents.find((x) => x.agentId === l.agentId);
            return (
              <tr key={l.agentId}>
                <Td className="whitespace-nowrap font-medium">{a?.name ?? `Agent ${l.agentId}`}</Td>
                <Td mono className="whitespace-nowrap">{a?.choice ? `${a.choice} · ${formatBps(a.probability ?? 0, 0)}` : muted("none")}</Td>
                <Td>
                  <StatusMark tone={l.result === "CORRECT" ? "pass" : l.result === "NEUTRAL" || !l.result ? "neutral" : "fail"}>{l.result ?? "—"}</StatusMark>
                </Td>
                <Td align="right" mono>{formatMon(l.bond)}</Td>
                <Td align="right" mono>{formatMon(l.reward)}</Td>
                <Td align="right" mono>{formatMon(l.penalty)}</Td>
                <Td align="right" mono className={l.net > 0n ? "text-pass" : l.net < 0n ? "text-fail" : ""}>
                  {l.net < 0n ? `−${formatMon(-l.net)}` : `+${formatMon(l.net)}`}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-[12px] text-ink-3">
        {mode === "simulation"
          ? "Computed with OutcomeRegistry's formula on notional bonds (MON). No bond was locked and nothing is transferred."
          : "Applied by OutcomeRegistry in the resolve transaction; bonds and the reward pool changed on-chain."}
      </p>
    </div>
  );
}
