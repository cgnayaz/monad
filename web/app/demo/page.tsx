import type { Metadata } from "next";
import { AgentTable } from "@/components/domain/agent-table";
import { ForkTable } from "@/components/domain/fork-table";
import { QuestionList } from "@/components/domain/question-list";
import { ReadinessPanel } from "@/components/domain/readiness-panel";
import { StateTable } from "@/components/domain/state-table";
import { Button } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { collectState } from "@/lib/collectors";
import { listAgents } from "@/lib/data/agents";
import { readiness } from "@/lib/data/readiness";
import { formatDuration, formatUtc } from "@/lib/format";
import { buildQuestionSet } from "@/lib/jev/questions";
import { DEFAULT_PARAMS } from "@/lib/decmarkt/params";

export const metadata: Metadata = { title: "Live demo" };
export const dynamic = "force-dynamic";

const STAGES = [
  { status: "CREATED", step: "Snapshot state and commit hashes", by: "Proposer → DecisionRegistry.createDecision" },
  { status: "OPEN", step: "Lock bonds, open submission window", by: "Proposer → DecisionRegistry.openDecision" },
  { status: "OPEN", step: "Five agents decide in parallel and submit", by: "Agent operators → DecisionRegistry.submit" },
  { status: "AGGREGATED", step: "Aggregate and evaluate threshold", by: "Keeper → DecisionEngine.aggregate" },
  { status: "APPROVED", step: "Approve bounded action (guardian if escalated)", by: "DecisionEngine" },
  { status: "EXECUTED", step: "Execute approved fork, record start price", by: "Keeper → ExecutionVault.execute" },
  { status: "RESOLVED", step: "Verify outcome after horizon, settle bonds", by: "Keeper → OutcomeRegistry.resolve" },
] as const;

export default async function DemoPage() {
  const [committed, agents] = await Promise.all([collectState(), listAgents()]);
  const { questionSet, questionsHash } = buildQuestionSet();
  const r = readiness();
  const okInputs = committed.state.inputs.filter((i) => i.status === "ok").length;

  return (
    <>
      <PageHeader
        eyebrow="Live demo · Monad Testnet"
        title="Run an accountable decision round"
        lead="Every stage below is a real transaction on Monad Testnet. The state is snapshotted and committed before any agent runs; agents choose only among bounded forks; settlement follows from a verified oracle outcome."
      />

      <div className="mb-14 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Round stages">
          <ol>
            {STAGES.map((s, i) => (
              <li key={s.step} className="grid grid-cols-[32px_1fr] gap-x-3 border-b border-rule px-4 py-3 last:border-b-0 sm:grid-cols-[32px_1fr_120px]">
                <span className="font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p>{s.step}</p>
                  <p className="font-mono text-[11.5px] text-ink-3">{s.by}</p>
                </div>
                <span className="col-start-2 font-mono text-[11px] tracking-[0.04em] text-ink-2 sm:col-start-auto sm:text-right">{s.status}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-4 border-t border-rule px-4 py-4">
            <Button disabled={!r.ready} aria-describedby="start-note">
              Start round
            </Button>
            <p id="start-note" className="text-[13px] text-ink-2">
              {r.ready
                ? `Submission window ${formatDuration(DEFAULT_PARAMS.submissionWindowSec)}, horizon ${formatDuration(DEFAULT_PARAMS.horizonSec)}.`
                : "Unavailable until every readiness check passes. No round is simulated."}
            </p>
          </div>
        </Panel>
        <ReadinessPanel r={r} />
      </div>

      <Section
        index="01"
        title="Jev state — live snapshot"
        description={
          <>
            Collected now from its sources. This is a <strong className="font-medium text-ink">preview</strong>: it is
            hashed exactly as a round would commit it, but nothing is written on-chain until a round starts.
          </>
        }
        aside={<StatusMark tone={okInputs === committed.state.inputs.length ? "pass" : "wait"}>{okInputs}/{committed.state.inputs.length} inputs available</StatusMark>}
      >
        <div className="mb-4 border border-rule bg-surface">
          <KeyValue
            rows={[
              { k: "State id", v: <span className="font-mono text-[12.5px]">{committed.state.stateId}</span> },
              { k: "State hash", v: <Hash value={committed.stateHash} full /> },
              { k: "Observed", v: <span className="font-mono text-[12.5px]">{formatUtc(committed.state.observedAt)}</span> },
              { k: "Subject", v: `MON vault · reference ${committed.state.subject.referenceFeed} · horizon ${formatDuration(committed.state.subject.horizonSec)} · band ±${committed.state.subject.bandBps} bps` },
              { k: "Schema", v: <span className="font-mono text-[12.5px]">{committed.state.schema}</span> },
            ]}
          />
        </div>
        <StateTable inputs={committed.state.inputs} />
      </Section>

      <Section
        index="02"
        title="Jev questions"
        description="What the agents actually evaluate. Each agent answers its primary question and the action question; every answer is a full Jev decision."
        aside={<span className="font-mono text-[12px] text-ink-2" title={questionsHash}>questionsHash {questionsHash.slice(0, 10)}…</span>}
      >
        <QuestionList set={questionSet} />
      </Section>

      <Section index="03" title="Bounded forks" description="The only choices an agent can make, and the only actions the vault can take.">
        <ForkTable />
      </Section>

      <Section index="04" title="Decision makers" description="Independent runs, one operator address and one bond per agent.">
        <AgentTable agents={agents} />
      </Section>
    </>
  );
}
