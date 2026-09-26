"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusMark, type Tone } from "@/components/ui/status";
import { formatBps } from "@/lib/format";
import type { DecisionView } from "@/lib/view/decision-view";
import {
  ActionStep,
  AggregationStep,
  BatchStep,
  Countdown,
  ForksStep,
  MonadStep,
  ParallelStep,
  PrimitivesStep,
  QuestionsStep,
  SettlementStep,
  StateStep,
  VerifyStep,
} from "./step-content";
import { STEPS, useDemo, type DemoMode, type StepKey, type StepStatus } from "./use-demo";

interface ModeAvailability {
  ok: boolean;
  reason: string;
}

const STEP_COPY: Record<StepKey, { title: string; what: string }> = {
  STATE: { title: "State", what: "The facts the decision is about, collected now from their sources and hashed." },
  QUESTIONS: { title: "Questions", what: "Jev turns the state into explicit questions. Each has its own id and the inputs it evaluates." },
  PARALLEL: { title: "Parallel decisions", what: "Five analysts start at the same moment on the same state; none sees another's output." },
  PRIMITIVES: { title: "Choice · Score · Probability · Reason", what: "Each analyst's final decision. The score comes from its rubric ratings; the reason is informational only." },
  BATCH: { title: "Batch and question results", what: "Every question-level answer is kept; the action question is what gets aggregated." },
  FORKS: { title: "Bounded forks", what: "The complete action space, fixed before any agent ran. Nothing outside it can execute." },
  AGGREGATION: { title: "Aggregation", what: "DecMarkt's deterministic rules: probability × track record per fork, then the threshold. No model is asked." },
  ACTION: { title: "Action", what: "The one predefined action the rules approved, or NO_ACTION as the fail-safe." },
  MONAD: { title: "Monad", what: "Commitment, bonded submissions, aggregation and execution as transactions on Monad Testnet." },
  VERIFY: { title: "Verify", what: "After the horizon, the real price move decides which action was correct: expected versus observed." },
  SETTLEMENT: { title: "Settlement", what: "Bonds are returned, rewarded or penalised by fixed rules. Agents have no say." },
};

const tone: Record<StepStatus, Tone> = { pending: "neutral", active: "wait", done: "pass", failed: "fail", skipped: "neutral", stopped: "neutral" };

export function Demo({ modes, idle, allowedForks }: { modes: Record<DemoMode, ModeAvailability>; idle: DecisionView; allowedForks: string[] }) {
  const d = useDemo();
  const started = d.startedAt !== null;
  const v = started ? d.view : idle;
  const current = STEPS.find((k) => d.steps[k].status === "active" || d.steps[k].status === "failed");
  const failed = STEPS.find((k) => d.steps[k].status === "failed");
  const liveRound = started && d.mode === "live";

  const content: Record<StepKey, ReactNode> = {
    STATE: <StateStep v={v} live={liveRound} commitTx={d.txs.find((t) => t.label === "createDecision")} />,
    QUESTIONS: <QuestionsStep v={v} />,
    PARALLEL: <ParallelStep v={v} startedAt={d.parallelStartedAt} />,
    PRIMITIVES: <PrimitivesStep v={v} />,
    BATCH: <BatchStep v={v} decision={d.decision ?? null} />,
    FORKS: <ForksStep v={v} allowed={allowedForks} />,
    AGGREGATION: <AggregationStep v={v} />,
    ACTION: <ActionStep v={v} mode={d.mode} sim={d.simExecution} />,
    MONAD: <MonadStep mode={d.mode} txs={d.txs} awaiting={d.awaitingExecution} onExecute={d.executeLive} walletTx={d.walletTx} />,
    VERIFY: (
      <div className="space-y-3">
        {d.countdown && <Countdown {...d.countdown} />}
        <VerifyStep r={d.verify} mode={d.mode} />
      </div>
    ),
    SETTLEMENT: <SettlementStep mode={d.mode} v={v} sim={d.simSettlement} />,
  };

  // Before a round starts, the current snapshot and the action space are already real and shown.
  const visible = (k: StepKey) => {
    const s = d.steps[k].status;
    if (!started) return k === "STATE" || k === "QUESTIONS" || k === "FORKS";
    if (k === "MONAD") return s !== "pending" || d.mode === "simulation";
    if (k === "PARALLEL") return s !== "pending";
    return s === "done" || s === "active" || s === "failed" || (k === "FORKS" && s !== "stopped");
  };

  return (
    <div className="space-y-6">
      {/* Mode + control */}
      <div className="border border-rule bg-surface">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {(["simulation", "live"] as const).map((m, i) => {
            const selected = d.mode === m;
            const ok = modes[m].ok;
            return (
              <button
                key={m}
                type="button"
                disabled={!ok || d.running}
                onClick={() => d.setMode(m)}
                aria-pressed={selected}
                className={`relative px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed ${i === 0 ? "max-md:border-b md:border-r" : ""} border-rule ${
                  selected ? "bg-surface-2" : "hover:bg-surface-2/60"
                }`}
              >
                <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 ${selected ? (m === "live" ? "bg-accent" : "bg-ink") : "bg-transparent"}`} />
                <span className="flex items-center justify-between gap-3">
                  <span className={`text-[13px] font-semibold ${ok ? "" : "text-ink-3"}`}>{m === "simulation" ? "Simulation mode" : "Live testnet mode"}</span>
                  <StatusMark tone={ok ? (selected ? "accent" : "neutral") : "neutral"}>{ok ? (selected ? "selected" : "available") : "unavailable"}</StatusMark>
                </span>
                <span className="mt-1 block text-[12.5px] text-ink-2">{modes[m].reason}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule px-4 py-3">
          <Button onClick={d.start} disabled={!modes[d.mode].ok || d.running}>
            {d.running ? "Running…" : started ? "Run again" : d.mode === "live" ? "Start live round" : "Start simulation"}
          </Button>
          {failed && !d.running && (
            <Button variant="secondary" onClick={d.retry}>
              Retry {STEP_COPY[failed].title.toLowerCase()}
            </Button>
          )}
          <span className="text-[12.5px] text-ink-2">Demo time scale: 90 s submission window, 60 s horizon. Same rules, shorter clock.</span>
        </div>
      </div>

      {/* Mode banner: never ambiguous about what is on-chain */}
      {started &&
        (d.mode === "simulation" ? (
          <div className="border border-rule bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--surface-2)_8px_9px)] px-4 py-2.5 text-[12.5px]">
            <span className="mr-2 font-mono font-medium tracking-[0.06em]">SIMULATION</span>
            <span className="text-ink-2">Real state and real agents. No transactions: execution, verification and settlement are computed locally and nothing here is on-chain.</span>
          </div>
        ) : (
          <div className="border border-accent px-4 py-2.5 text-[12.5px]">
            <span className="mr-2 font-mono font-medium tracking-[0.06em] text-accent">LIVE · MONAD TESTNET</span>
            <span className="text-ink-2">Every stage below is a transaction on chain 10143{d.decision?.mode === "live" ? ` · decision #${d.decision.decisionId}` : ""}.</span>
          </div>
        ))}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* The narrative */}
        <ol className="min-w-0">
          {STEPS.map((k, i) => {
            const s = d.steps[k];
            const show = visible(k);
            const isLast = i === STEPS.length - 1;
            return (
              <li key={k} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-4">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border font-mono text-[11px] ${
                      s.status === "done" ? "border-ink bg-ink text-bg" : s.status === "active" ? "border-accent text-accent" : s.status === "failed" ? "border-fail text-fail" : "border-rule text-ink-3"
                    } ${s.status === "active" ? "dm-pending" : ""}`}
                  >
                    {i + 1}
                  </span>
                  {!isLast && <span className={`w-px flex-1 ${s.status === "done" ? "bg-ink" : "bg-rule"}`} />}
                </div>
                <section className={`min-w-0 pb-8 ${show ? "" : "pb-5"}`} aria-labelledby={`step-${k}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 id={`step-${k}`} className={`text-[15px] font-medium ${s.status === "pending" || s.status === "stopped" ? "text-ink-2" : ""}`}>
                      {STEP_COPY[k].title}
                    </h2>
                    {started && (
                      <StatusMark tone={tone[s.status]} live={s.status === "active"}>
                        {s.status}
                      </StatusMark>
                    )}
                  </div>
                  <p className="mt-0.5 max-w-[72ch] text-[12.5px] text-ink-2">
                    {STEP_COPY[k].what}
                    {s.note && <span className="text-ink-3"> — {s.note}</span>}
                  </p>
                  {s.status === "failed" && s.error && (
                    <div role="alert" className="mt-3 border border-fail px-4 py-3 text-[13px]">
                      <p className="font-medium text-fail">Stopped at {STEP_COPY[k].title.toLowerCase()}</p>
                      <p className="mt-1 break-words font-mono text-[12px] text-ink">{s.error}</p>
                      <div className="mt-3">
                        <Button variant="secondary" onClick={d.retry} disabled={d.running}>
                          Retry
                        </Button>
                      </div>
                    </div>
                  )}
                  {show && <div className="dm-arrive mt-3">{content[k]}</div>}
                  {!started && show && k !== "FORKS" && <p className="mt-2 text-[11.5px] text-ink-3">Current snapshot — committed when a round starts.</p>}
                </section>
              </li>
            );
          })}
        </ol>

        {/* Round summary */}
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="border border-rule bg-surface">
            <p className="border-b border-rule px-4 py-2.5 text-[13px] font-semibold">Round</p>
            <dl className="divide-y divide-rule text-[12.5px]">
              <Row k="Mode" v={d.mode === "live" ? "live testnet" : "simulation"} />
              <Row k="Decision" v={d.decision?.mode === "live" ? `#${d.decision.decisionId}` : started ? "not on-chain" : "—"} />
              <Row k="Step" v={current ? `${STEPS.indexOf(current) + 1} · ${STEP_COPY[current].title}` : started ? "complete" : "not started"} />
              <Row k="Agents" v={started ? `${v.agents.filter((a) => a.status === "ok").length}/5 decided` : "—"} />
              <Row k="Selected" v={v.aggregation?.leading ?? "—"} />
              <Row k="Threshold" v={v.aggregation ? `${v.aggregation.supportShareBps != null ? formatBps(v.aggregation.supportShareBps, 1) : "—"} · ${v.aggregation.passed ? "passed" : "not met"}` : "—"} />
              <Row k="Action" v={v.action?.fork ?? "—"} />
              <Row k="Outcome" v={d.verify ? `${d.verify.observed} · ${d.verify.success ? "success" : "miss"}` : "—"} />
            </dl>
          </div>
          {d.decision?.mode === "live" && (
            <Link href={`/decisions/${d.decision.decisionId}`} className="mt-3 block text-[13px] text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink">
              Full audit record of decision #{d.decision.decisionId} →
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 px-4 py-2">
      <dt className="label self-center">{k}</dt>
      <dd className="truncate font-mono">{v}</dd>
    </div>
  );
}
