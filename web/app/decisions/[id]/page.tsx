import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { NotDeployed } from "@/components/domain/not-deployed";
import { statusTone } from "@/components/domain/decision-table";
import { SupportBars } from "@/components/domain/support-bars";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { EmptyState, StatusMark, Unavailable } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { getDecision } from "@/lib/data/decisions";
import { formatBps, formatDuration, formatMon, formatPrice, formatUtc } from "@/lib/format";
import { AGENTS } from "@/lib/jev/agents";
import { maskToForks } from "@/lib/jev/forks";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/decisions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Decision #${id}` };
}

const agentName = (id: number) => AGENTS.find((a) => a.agentId === id)?.name ?? `Agent ${id}`;
const PAYLOAD_NOTE = "Off-chain payload store is not connected yet; only on-chain values are shown.";

export default async function DecisionPage(props: PageProps<"/decisions/[id]">) {
  const { id: raw } = await props.params;
  if (!/^\d+$/.test(raw)) notFound();
  const res = await getDecision(BigInt(raw));

  if (res.status === "unavailable") {
    return (
      <>
        <PageHeader eyebrow="Decision" title={`Decision #${raw}`} />
        {res.reason.startsWith("Contracts") ? <NotDeployed what="decision records" /> : <EmptyState title="Decision unavailable">{res.reason}</EmptyState>}
      </>
    );
  }
  const d = res.value;
  if (!d) notFound();

  const sections = [
    ["state", "State"],
    ["questions", "Questions"],
    ["decisions", "Decisions"],
    ["aggregation", "Aggregation"],
    ["action", "Action"],
    ["outcome", "Outcome"],
    ["settlement", "Settlement"],
    ["integrity", "Integrity"],
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Decision"
        title={`Decision #${d.id.toString()}`}
        lead={`Created ${formatUtc(d.createdAt)} by ${d.proposer}. ${d.participants} participating agents.`}
        aside={<StatusMark tone={statusTone(d.status)}>{d.status}</StatusMark>}
      />

      <div className="mb-10">
        <LifecycleRail current={d.status} transitions={d.transitions} />
      </div>

      <nav aria-label="Sections" className="mb-10 flex flex-wrap gap-x-5 gap-y-2 border-b border-rule pb-3 text-[13px] text-ink-2">
        {sections.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} className="hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Section id="state" index="01" title="State" description="The state hash committed before any agent ran.">
        <Panel>
          <KeyValue
            rows={[
              { k: "State hash", v: <Hash value={d.stateHash} full /> },
              { k: "Inputs", v: <Unavailable reason={PAYLOAD_NOTE} /> },
              { k: "Horizon", v: formatDuration(d.config.horizon) },
              { k: "Band", v: `±${d.config.bandBps} bps` },
            ]}
          />
        </Panel>
      </Section>

      <Section id="questions" index="02" title="Questions">
        <Panel>
          <KeyValue
            rows={[
              { k: "Questions hash", v: <Hash value={d.questionsHash} full /> },
              { k: "Allowed forks", v: <span className="font-mono text-[12.5px]">{maskToForks(d.config.allowedForks).join(" · ")}</span> },
            ]}
          />
        </Panel>
      </Section>

      <Section id="decisions" index="03" title="Decisions" description="Each agent's final decision as stored on-chain. Agents that did not submit remain listed.">
        <Table caption="Agent decisions">
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Choice</Th>
              <Th align="right">Score</Th>
              <Th align="right">Probability</Th>
              <Th>Reason hash</Th>
              <Th>Answers root</Th>
              <Th>Submitted</Th>
            </tr>
          </thead>
          <tbody>
            {d.submissions.map((s) => (
              <tr key={s.agentId}>
                <Td className="whitespace-nowrap font-medium">{agentName(s.agentId)}</Td>
                <Td mono>{s.choice ?? <StatusMark tone="fail">missed</StatusMark>}</Td>
                <Td align="right" mono>{s.score ?? "—"}</Td>
                <Td align="right" mono>{s.probability !== null ? formatBps(s.probability) : "—"}</Td>
                <Td>{s.reasonHash ? <Hash value={s.reasonHash} /> : "—"}</Td>
                <Td>{s.answersRoot ? <Hash value={s.answersRoot} /> : "—"}</Td>
                <Td mono className="text-ink-2">{s.submittedAt ? formatUtc(s.submittedAt) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section id="aggregation" index="04" title="Aggregation">
        {d.aggregation ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SupportBars support={d.aggregation.support} total={d.aggregation.totalSupport} thresholdBps={d.config.thresholdBps} />
            <Panel>
              <KeyValue
                rows={[
                  { k: "Leading fork", v: <span className="font-mono">{d.aggregation.leading}</span> },
                  { k: "Threshold", v: <StatusMark tone={d.aggregation.thresholdPassed ? "pass" : "fail"}>{d.aggregation.thresholdPassed ? "passed" : "not met"}</StatusMark> },
                  { k: "Submissions", v: `${d.aggregation.submissions} (quorum ${d.config.quorum})` },
                  { k: "Approved action", v: <span className="font-mono">{d.aggregation.guardianRequired && d.status === "AGGREGATED" ? "awaiting guardian" : d.aggregation.approved}</span> },
                  ...(d.aggregation.guardianRequired ? [{ k: "Guardian deadline", v: formatUtc(d.aggregation.guardianDeadline) }] : []),
                ]}
              />
            </Panel>
          </div>
        ) : (
          <EmptyState title="Not aggregated yet">Aggregation runs after the submission deadline ({formatUtc(d.deadline)}) or once every participant has submitted.</EmptyState>
        )}
      </Section>

      <Section id="action" index="05" title="Action">
        {d.execution ? (
          <Panel>
            <KeyValue
              rows={[
                { k: "Executed fork", v: <span className="font-mono">{d.execution.action}</span> },
                { k: "Amount moved", v: `${formatMon(d.execution.amountMoved)} MON` },
                { k: "Buckets after", v: `ACTIVE ${formatMon(d.execution.activeAfter)} · RESERVE ${formatMon(d.execution.reserveAfter)} MON` },
                { k: "Start price", v: `${formatPrice(d.execution.startPrice, d.execution.expo)} USD · published ${formatUtc(d.execution.startPublishTime)}` },
                { k: "Executed at", v: formatUtc(d.execution.executedAt) },
              ]}
            />
          </Panel>
        ) : (
          <EmptyState title="Not executed yet">Execution follows approval. Only the approved fork can run.</EmptyState>
        )}
      </Section>

      <Section id="outcome" index="06" title="Outcome">
        {d.outcome && d.execution ? (
          <Panel>
            <KeyValue
              rows={[
                { k: "End price", v: `${formatPrice(d.outcome.endPrice, d.execution.expo)} USD · published ${formatUtc(d.outcome.endPublishTime)}` },
                { k: "Move", v: `${d.outcome.moveBps.toString()} bps (band ±${d.config.bandBps})` },
                { k: "Correct fork", v: <span className="font-mono">{d.outcome.correctFork}</span> },
                { k: "Resolved at", v: formatUtc(d.outcome.resolvedAt) },
              ]}
            />
          </Panel>
        ) : (
          <EmptyState title="Not resolved yet">The outcome is verified from a signed Pyth price published inside the resolution window after the horizon.</EmptyState>
        )}
      </Section>

      <Section id="settlement" index="07" title="Settlement">
        {d.settlement ? (
          <Table caption="Settlement">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Result</Th>
                <Th align="right">Lock released</Th>
                <Th align="right">Penalty</Th>
                <Th align="right">Reward</Th>
              </tr>
            </thead>
            <tbody>
              {d.settlement.map((l) => (
                <tr key={l.agentId}>
                  <Td className="font-medium">{agentName(l.agentId)}</Td>
                  <Td>
                    <StatusMark tone={l.result === "CORRECT" ? "pass" : l.result === "NEUTRAL" ? "neutral" : "fail"}>{l.result}</StatusMark>
                  </Td>
                  <Td align="right" mono>{formatMon(l.lockReleased)}</Td>
                  <Td align="right" mono>{formatMon(l.penalty)}</Td>
                  <Td align="right" mono>{formatMon(l.reward)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Not settled yet">Bonds settle in the same transaction that resolves the outcome.</EmptyState>
        )}
      </Section>

      <Section id="integrity" index="08" title="Integrity" description="Off-chain payloads recomputed in the browser and compared with on-chain hashes.">
        <EmptyState title="Payload verification unavailable">{PAYLOAD_NOTE}</EmptyState>
      </Section>

      <p className="text-[12px] text-ink-3">
        Registry reads at the latest block. Transactions link to{" "}
        <a className="underline decoration-rule underline-offset-2" href={explorer.address(d.proposer)} target="_blank" rel="noreferrer">
          Monad Explorer
        </a>
        .
      </p>
    </>
  );
}
