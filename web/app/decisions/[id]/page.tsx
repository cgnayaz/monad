import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentModules } from "@/components/decision/agent-modules";
import { JevTrack } from "@/components/decision/jev-track";
import { KeyFigures } from "@/components/decision/key-figures";
import {
  ActionPanel,
  AggregationPanel,
  IntegrityPanel,
  OutcomePanel,
  QuestionsPanel,
  SettlementPanel,
  StatePanel,
  TransitionsTable,
} from "@/components/decision/panels";
import { statusTone } from "@/components/domain/decision-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { NotDeployed } from "@/components/domain/not-deployed";
import { ProvenanceTrail } from "@/components/domain/provenance-trail";
import { Hash } from "@/components/ui/hash";
import { PageHeader, Section } from "@/components/ui/layout";
import { EmptyState, StatusMark } from "@/components/ui/status";
import { LifecycleActions } from "@/components/wallet/lifecycle-actions";
import { explorer } from "@/lib/chain/monad";
import { getDecisionProvenance } from "@/lib/data/decisions";
import { attachVerifiedPayloads } from "@/lib/data/payloads";
import { formatDuration, formatMon, formatUtc } from "@/lib/format";
import { maskToForks } from "@/lib/jev/forks";
import { traceDecision, validateProvenance } from "@/lib/model/provenance";
import { fromProvenance } from "@/lib/view/decision-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/decisions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Decision #${id}` };
}

const SECTIONS = [
  ["state", "State"],
  ["questions", "Questions"],
  ["decisions", "Agent decisions"],
  ["aggregation", "Aggregation"],
  ["action", "Action"],
  ["transactions", "Transactions"],
  ["outcome", "Outcome"],
  ["settlement", "Settlement"],
  ["integrity", "Integrity"],
  ["provenance", "Provenance"],
] as const;

export default async function DecisionPage(props: PageProps<"/decisions/[id]">) {
  const { id: raw } = await props.params;
  if (!/^\d+$/.test(raw)) notFound();
  const res = await getDecisionProvenance(BigInt(raw));

  if (res.status === "unavailable") {
    return (
      <>
        <PageHeader eyebrow="Decision record" title={`Decision #${raw}`} />
        {res.reason.startsWith("Contracts") ? <NotDeployed what="decision records" /> : <EmptyState title="Decision unavailable">{res.reason}</EmptyState>}
      </>
    );
  }
  if (!res.value) notFound();

  const verified = await attachVerifiedPayloads(res.value);
  const p = verified.provenance;
  const v = fromProvenance(p, verified.checks);
  const d = p.decision;
  const issues = validateProvenance(p);
  const n = (i: number) => String(i + 1).padStart(2, "0");

  return (
    <>
      <PageHeader
        eyebrow="Decision record · Monad Testnet"
        title={`Decision #${d.decisionId}`}
        lead={
          <span className="font-mono text-[13px]">
            created {formatUtc(d.createdAt)} · proposer <a className="underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.address(d.proposer)} target="_blank" rel="noreferrer">{d.proposer}</a>
          </span>
        }
        aside={<StatusMark tone={statusTone(d.status)}>{d.status}</StatusMark>}
      />

      <div className="mb-6">
        <LifecycleRail current={d.status} transitions={d.transitions} />
      </div>
      {!["RESOLVED", "CANCELLED"].includes(d.status) && (
        <div className="mb-6 max-w-[760px]">
          <LifecycleActions
            ctx={{
              decisionId: d.decisionId,
              status: d.status,
              deadline: d.deadline,
              finalsSubmitted: p.submissions.filter((s) => s.questionIndex === 0).length,
              participants: d.participants.length,
              guardianRequired: p.aggregation?.guardianRequired ?? false,
              guardianDeadline: p.aggregation?.guardianDeadline ?? null,
              allowedForks: d.config.allowedForks,
              executedAt: p.action?.execution?.executedAt ?? null,
              horizon: d.config.horizon,
            }}
          />
        </div>
      )}
      <div className="mb-6">
        <JevTrack stages={v.stages} />
      </div>
      <div className="mb-10">
        <KeyFigures v={v} />
      </div>

      <nav aria-label="Record sections" className="sticky top-0 z-10 -mx-4 mb-10 flex gap-x-5 overflow-x-auto border-b border-rule bg-bg/95 px-4 py-2.5 text-[13px] text-ink-2 [scrollbar-width:none] sm:-mx-6 sm:px-6">
        {SECTIONS.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} className="whitespace-nowrap hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Section id="state" index={n(0)} title="State" description="The snapshot the agents evaluated. Its hash was committed before any agent ran.">
        <StatePanel v={v} />
      </Section>

      <Section
        id="questions"
        index={n(1)}
        title="Questions"
        description={`${v.questions.items?.length ?? "—"} questions · allowed forks ${maskToForks(d.config.allowedForks).join(" · ")} · horizon ${formatDuration(d.config.horizon)} · band ±${d.config.bandBps} bps`}
      >
        <QuestionsPanel v={v} />
      </Section>

      <Section id="decisions" index={n(2)} title="Agent decisions" description={`Each participant's final decision as recorded on-chain, backed by a ${formatMon(d.config.lockPerAgent)} MON bond. Reasons appear when their text verifies against the on-chain hash.`}>
        <AgentModules agents={v.agents} />
      </Section>

      <Section id="aggregation" index={n(3)} title="Aggregation & threshold" description="Read from DecisionEngine; the same integer formula runs off-chain and can be reproduced from the submissions.">
        <div className="max-w-[720px]">
          <AggregationPanel v={v} />
        </div>
      </Section>

      <Section id="action" index={n(4)} title="Bounded action">
        <div className="max-w-[720px]">
          <ActionPanel v={v} />
        </div>
      </Section>

      <Section id="transactions" index={n(5)} title="Transactions" description="Every lifecycle transition, the contract function that caused it (decoded from calldata) and its block.">
        {v.transitions.length ? <TransitionsTable v={v} /> : <EmptyState title="No transitions readable" />}
      </Section>

      <Section id="outcome" index={n(6)} title="Outcome">
        <div className="max-w-[720px]">
          <OutcomePanel v={v} />
        </div>
      </Section>

      <Section id="settlement" index={n(7)} title="Settlement" aside={<StatusMark tone={v.settlement.status === "SETTLED" ? "pass" : "wait"}>{v.settlement.status}</StatusMark>}>
        <SettlementPanel v={v} />
      </Section>

      <Section
        id="integrity"
        index={n(8)}
        title="Integrity"
        description={verified.store.available ? `Off-chain payloads (${verified.store.kind}) recomputed and compared with the on-chain commitments.` : `${verified.store.reason}. On-chain values are shown without their payloads.`}
      >
        {v.integrity.length ? <IntegrityPanel v={v} /> : <EmptyState title="No checks" />}
      </Section>

      <Section
        id="provenance"
        index={n(9)}
        title="Provenance"
        description="Each agent's final decision traced from state to settlement. Every link is checked against its neighbours on each load."
        aside={<StatusMark tone={issues.length ? "fail" : "pass"}>{issues.length ? `${issues.length} inconsistencies` : "consistent"}</StatusMark>}
      >
        {issues.length > 0 && (
          <ul className="mb-4 border border-fail px-4 py-3 text-[13px] text-fail">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {d.participants.map((agentId) => (
            <div key={agentId} className="min-w-0">
              <p className="mb-2 text-[13px] font-semibold">{v.agents.find((a) => a.agentId === agentId)?.name ?? `Agent ${agentId}`}</p>
              <ProvenanceTrail steps={traceDecision(p, agentId)} />
            </div>
          ))}
        </div>
        <p className="mt-6 text-[12px] text-ink-3">
          State hash <Hash value={d.stateHash} /> · questions hash <Hash value={d.questionsHash} />
        </p>
      </Section>
    </>
  );
}
