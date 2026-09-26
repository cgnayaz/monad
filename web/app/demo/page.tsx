import type { Metadata } from "next";
import { AgentTable } from "@/components/domain/agent-table";
import { ForkTable } from "@/components/domain/fork-table";
import { QuestionList } from "@/components/domain/question-list";
import { ReadinessPanel } from "@/components/domain/readiness-panel";
import { StateTable } from "@/components/domain/state-table";
import { RoundRunner } from "@/components/domain/round/round-runner";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Section } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { collectState } from "@/lib/collectors";
import { listAgents } from "@/lib/data/agents";
import { readiness } from "@/lib/data/readiness";
import { formatDuration, formatUtc } from "@/lib/format";
import { buildQuestionSet } from "@/lib/jev/questions";

export const metadata: Metadata = { title: "Live demo" };
export const dynamic = "force-dynamic";


export default async function DemoPage() {
  const [state, agents] = await Promise.all([collectState(), listAgents()]);
  const questionSet = buildQuestionSet(state, state.timestamp);
  const r = readiness();
  const okInputs = state.data.inputs.filter((i) => i.status === "ok").length;

  return (
    <>
      <PageHeader
        eyebrow="Live demo · Monad Testnet"
        title="Run an accountable decision round"
        lead="The state is snapshotted and committed before any agent runs; five analysts decide in parallel among bounded forks; fixed rules aggregate their decisions, apply the threshold and select the action; the execution layer carries it out on Monad."
      />

      <div className="mb-14">
        <RoundRunner mode={r.mode} modeDetail={r.modeDetail} aside={<ReadinessPanel r={r} />} />
      </div>

      <Section
        index="01"
        title="Jev state — current snapshot"
        description={
          <>
            Collected now from its sources. This is a <strong className="font-medium text-ink">preview</strong>: it is
            hashed exactly as a round would commit it, but nothing is written on-chain until a round starts.
          </>
        }
        aside={<StatusMark tone={okInputs === state.data.inputs.length ? "pass" : "wait"}>{okInputs}/{state.data.inputs.length} inputs available</StatusMark>}
      >
        <div className="mb-4 border border-rule bg-surface">
          <KeyValue
            rows={[
              { k: "State id", v: <span className="font-mono text-[12.5px]">{state.stateId}</span> },
              { k: "State hash", v: <Hash value={state.hash} full /> },
              { k: "Timestamp", v: <span className="font-mono text-[12.5px]">{formatUtc(state.timestamp)}</span> },
              { k: "Sources", v: <span className="font-mono text-[12.5px]">{state.source.join(" · ")}</span> },
              { k: "Subject", v: `MON vault · reference ${state.data.subject.referenceFeed} · horizon ${formatDuration(state.data.subject.horizonSec)} · band ±${state.data.subject.bandBps} bps` },
              { k: "Version", v: <span className="font-mono text-[12.5px]">{state.version}</span> },
            ]}
          />
        </div>
        <StateTable inputs={state.data.inputs} />
      </Section>

      <Section
        index="02"
        title="Jev questions"
        description="What the agents actually evaluate. Each agent answers its primary question and the action question; every answer is a full Jev decision."
        aside={<span className="font-mono text-[12px] text-ink-2" title={questionSet.hash}>questionsHash {questionSet.hash.slice(0, 10)}…</span>}
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
