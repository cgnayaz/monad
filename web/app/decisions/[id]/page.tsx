import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { statusTone } from "@/components/domain/decision-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { NotDeployed } from "@/components/domain/not-deployed";
import { ProvenanceTrail } from "@/components/domain/provenance-trail";
import { SupportBars } from "@/components/domain/support-bars";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { EmptyState, StatusMark, Unavailable } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { getDecisionProvenance } from "@/lib/data/decisions";
import { formatBps, formatDuration, formatMon, formatPrice, formatUtc } from "@/lib/format";
import { maskToForks } from "@/lib/jev/forks";
import { finalSubmission, traceDecision, validateProvenance } from "@/lib/model/provenance";
import { FORKS } from "@/lib/types/protocol";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/decisions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Decision #${id}` };
}

const PAYLOAD_NOTE = "Off-chain payload store is not connected yet; only on-chain values are shown.";

export default async function DecisionPage(props: PageProps<"/decisions/[id]">) {
  const { id: raw } = await props.params;
  if (!/^\d+$/.test(raw)) notFound();
  const res = await getDecisionProvenance(BigInt(raw));

  if (res.status === "unavailable") {
    return (
      <>
        <PageHeader eyebrow="Decision" title={`Decision #${raw}`} />
        {res.reason.startsWith("Contracts") ? <NotDeployed what="decision records" /> : <EmptyState title="Decision unavailable">{res.reason}</EmptyState>}
      </>
    );
  }
  const p = res.value;
  if (!p) notFound();

  const d = p.decision;
  const agentName = (id: number) => p.agents.find((a) => a.agentId === id)?.name ?? `Agent ${id}`;
  const issues = validateProvenance(p);
  const exec = p.action?.execution ?? null;

  const sections = [
    ["state", "State"],
    ["questions", "Questions"],
    ["decisions", "Decisions"],
    ["aggregation", "Aggregation"],
    ["action", "Action"],
    ["outcome", "Outcome"],
    ["settlement", "Settlement"],
    ["provenance", "Provenance"],
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Decision"
        title={`Decision #${d.decisionId}`}
        lead={`Created ${formatUtc(d.createdAt)} by ${d.proposer}. ${d.participants.length} participating agents.`}
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

      <Section id="decisions" index="03" title="Decisions" description="Each agent's final decision (its answer to the ACTION question) as stored on-chain, with the number of questions it answered in its batch. Agents that did not submit remain listed.">
        <Table caption="Agent decisions">
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Choice</Th>
              <Th align="right">Score</Th>
              <Th align="right">Probability</Th>
              <Th align="right">Bond (MON)</Th>
              <Th>Reason hash</Th>
              <Th align="right">Answers</Th>
              <Th>Submitted</Th>
            </tr>
          </thead>
          <tbody>
            {d.participants.map((agentId) => {
              const s = finalSubmission(p, agentId);
              const answers = p.submissions.filter((x) => x.agentId === agentId).length;
              return (
                <tr key={agentId}>
                  <Td className="whitespace-nowrap font-medium">{agentName(agentId)}</Td>
                  <Td mono>{s?.choice ?? <StatusMark tone="fail">missed</StatusMark>}</Td>
                  <Td align="right" mono>{s ? s.score : "—"}</Td>
                  <Td align="right" mono>{s ? formatBps(s.probability) : "—"}</Td>
                  <Td align="right" mono>{formatMon(s?.bond ?? d.config.lockPerAgent)}</Td>
                  <Td>{s ? <Hash value={s.reasonHash} /> : "—"}</Td>
                  <Td align="right" mono>{answers}/{d.config.questionCount}</Td>
                  <Td mono className="text-ink-2">{s ? formatUtc(s.submittedAt) : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      <Section id="aggregation" index="04" title="Aggregation">
        {p.aggregation ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SupportBars support={FORKS.map((f) => p.aggregation!.support[f])} total={p.aggregation.total} thresholdBps={d.config.thresholdBps} />
            <Panel>
              <KeyValue
                rows={[
                  { k: "Leading fork", v: <span className="font-mono">{p.aggregation.leading}</span> },
                  { k: "Threshold", v: <StatusMark tone={p.aggregation.passed ? "pass" : "fail"}>{p.aggregation.passed ? "passed" : "not met"}</StatusMark> },
                  { k: "Submissions", v: `${p.aggregation.submissions} (quorum ${d.config.quorum})` },
                  { k: "Approved action", v: <span className="font-mono">{p.aggregation.approved ?? "awaiting guardian"}</span> },
                  ...(p.aggregation.guardianDeadline ? [{ k: "Guardian deadline", v: formatUtc(p.aggregation.guardianDeadline) }] : []),
                ]}
              />
            </Panel>
          </div>
        ) : (
          <EmptyState title="Not aggregated yet">
            Aggregation runs after the submission deadline{d.deadline ? ` (${formatUtc(d.deadline)})` : ""} or once every participant has submitted.
          </EmptyState>
        )}
      </Section>

      <Section id="action" index="05" title="Action">
        {p.action ? (
          <Panel>
            <KeyValue
              rows={[
                { k: "Approved fork", v: <span className="font-mono">{p.action.fork} · {p.action.definition.alias}</span> },
                { k: "Approved by", v: p.action.approvedBy },
                { k: "Effect", v: p.action.definition.effect },
                ...(exec
                  ? [
                      { k: "Amount moved", v: `${formatMon(exec.amountMoved)} MON` },
                      { k: "Buckets after", v: `ACTIVE ${formatMon(exec.after.active)} · RESERVE ${formatMon(exec.after.reserve)} MON` },
                      { k: "Start price", v: `${formatPrice(exec.startPrice.price, exec.startPrice.expo)} USD · published ${formatUtc(exec.startPrice.publishTime)}` },
                      { k: "Transaction", v: exec.tx ? <Hash value={exec.tx.hash} href={explorer.tx(exec.tx.hash)} /> : <Unavailable reason="log not readable" /> },
                    ]
                  : [{ k: "Execution", v: "pending" }]),
              ]}
            />
          </Panel>
        ) : (
          <EmptyState title="No action approved yet">Only the fork approved by the engine (or a guardian, on escalation) can execute.</EmptyState>
        )}
      </Section>

      <Section id="outcome" index="06" title="Outcome">
        {p.outcome ? (
          <Panel>
            <KeyValue
              rows={[
                { k: "Expected action", v: <span className="font-mono">{p.outcome.expectedAction}</span> },
                ...(p.outcome.observedResult
                  ? [
                      { k: "Observed", v: `${formatPrice(p.outcome.observedResult.start.price, p.outcome.observedResult.start.expo)} → ${formatPrice(p.outcome.observedResult.end.price, p.outcome.observedResult.end.expo)} USD · ${p.outcome.observedResult.moveBps.toString()} bps (band ±${p.outcome.observedResult.bandBps})` },
                      { k: "Correct fork", v: <span className="font-mono">{p.outcome.observedResult.correctFork}</span> },
                    ]
                  : [{ k: "Observed", v: "void — no valid oracle update inside the window" }]),
                { k: "Success", v: p.outcome.success === null ? "—" : <StatusMark tone={p.outcome.success ? "pass" : "fail"}>{p.outcome.success ? "yes" : "no"}</StatusMark> },
                {
                  k: "Verification source",
                  v: p.outcome.verificationSource.kind === "pyth" ? `Pyth ${p.outcome.verificationSource.contract}, window ${formatUtc(p.outcome.verificationSource.window.from)} + ${p.outcome.verificationSource.window.to - p.outcome.verificationSource.window.from} s` : "preview",
                },
                { k: "Resolved", v: formatUtc(p.outcome.timestamp) },
              ]}
            />
          </Panel>
        ) : (
          <EmptyState title="Not resolved yet">The outcome is verified from a signed Pyth price published inside the resolution window after the horizon.</EmptyState>
        )}
      </Section>

      <Section id="settlement" index="07" title="Settlement" aside={p.settlement && <StatusMark tone={p.settlement.settlementStatus === "SETTLED" ? "pass" : "wait"}>{p.settlement.settlementStatus}</StatusMark>}>
        {p.settlement ? (
          <Table caption="Settlement">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Result</Th>
                <Th align="right">Bond</Th>
                <Th align="right">Penalty</Th>
                <Th align="right">Reward</Th>
                <Th align="right">Net</Th>
              </tr>
            </thead>
            <tbody>
              {p.settlement.lines.map((l) => (
                <tr key={l.agentId}>
                  <Td className="font-medium">{agentName(l.agentId)}</Td>
                  <Td>{l.result ? <StatusMark tone={l.result === "CORRECT" ? "pass" : l.result === "NEUTRAL" ? "neutral" : "fail"}>{l.result}</StatusMark> : <span className="text-ink-3">{l.settlementStatus.toLowerCase()}</span>}</Td>
                  <Td align="right" mono>{formatMon(l.bond)}</Td>
                  <Td align="right" mono>{formatMon(l.penalty)}</Td>
                  <Td align="right" mono>{formatMon(l.reward)}</Td>
                  <Td align="right" mono>{l.net < 0n ? `−${formatMon(-l.net)}` : formatMon(l.net)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No bonds">This decision has no participants.</EmptyState>
        )}
      </Section>

      <Section
        id="provenance"
        index="08"
        title="Provenance"
        description="Each agent's final decision traced from state to settlement. Links are checked for consistency on every load."
        aside={<StatusMark tone={issues.length ? "fail" : "pass"}>{issues.length ? `${issues.length} inconsistencies` : "consistent"}</StatusMark>}
      >
        {issues.length > 0 && (
          <ul className="mb-4 border border-fail px-4 py-3 text-[13px] text-fail">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <div className="space-y-6">
          {d.participants.map((agentId) => (
            <div key={agentId}>
              <p className="mb-2 text-[13px] font-semibold">{agentName(agentId)}</p>
              <ProvenanceTrail steps={traceDecision(p, agentId)} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
