import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { EmptyState, StatusMark, type Tone } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { agentLedger } from "@/lib/data/accountability";
import { listAgents } from "@/lib/data/agents";
import { formatBps, formatMon, formatUtc } from "@/lib/format";
import { AGENTS } from "@/lib/jev/agents";
import { DOMAIN_LABEL } from "@/lib/view/decision-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/agents/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: AGENTS.find((a) => String(a.agentId) === id)?.name ?? "Agent" };
}

const tone = (r: string | null): Tone => (r === "CORRECT" ? "pass" : r === "WRONG" || r === "MISSED" ? "fail" : "neutral");
const signed = (w: bigint) => (w < 0n ? `−${formatMon(-w)}` : `+${formatMon(w)}`);

/** One agent's record: every prediction it made on-chain, what happened, and what it cost or earned. */
export default async function AgentPage(props: PageProps<"/agents/[id]">) {
  const { id } = await props.params;
  const spec = AGENTS.find((a) => String(a.agentId) === id);
  if (!spec) notFound();
  const [ledger, views] = await Promise.all([agentLedger(spec.agentId), listAgents()]);
  const onChain = views.find((x) => x.spec.agentId === spec.agentId)!.onChain;

  return (
    <>
      <PageHeader
        eyebrow={`Agent ${spec.agentId} · ${DOMAIN_LABEL[spec.key]}`}
        title={spec.name}
        lead={spec.mandate}
        aside={
          <Link href="/agents" className="text-[13px] text-ink-2 hover:text-ink">
            All agents →
          </Link>
        }
      />

      <div className="mb-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="On-chain identity">
          <KeyValue
            rows={[
              { k: "Operator", v: <Avail value={onChain}>{(a) => <Hash value={a.operator} href={explorer.address(a.operator)} full />}</Avail> },
              { k: "Status", v: <Avail value={onChain}>{(a) => <StatusMark tone={a.active ? "pass" : "neutral"}>{a.active ? "active" : "inactive"}</StatusMark>}</Avail> },
              { k: "Free bond", v: <Avail value={onChain}>{(a) => <span className="font-mono">{formatMon(a.bond)} MON</span>}</Avail> },
              { k: "Locked", v: <Avail value={onChain}>{(a) => <span className="font-mono">{formatMon(a.locked)} MON</span>}</Avail> },
            ]}
          />
        </Panel>
        <Panel title="Track record">
          <KeyValue
            rows={[
              {
                k: "Accuracy",
                v: (
                  <Avail value={onChain}>
                    {(a) => (
                      <span className="font-mono">
                        {a.correct} / {a.submitted} correct
                        {a.submitted > 0 && ` (${formatBps(Math.round((a.correct * 10_000) / a.submitted), 1)})`}
                      </span>
                    )}
                  </Avail>
                ),
              },
              {
                k: "Voting weight",
                v: <Avail value={onChain}>{(a) => <span className="font-mono">{formatBps(Math.floor(((a.correct + 1) * 10_000) / (a.submitted + 2)), 1)} of its probability</span>}</Avail>,
              },
              { k: "Missed", v: <Avail value={onChain}>{(a) => <span className="font-mono">{a.missed}</span>}</Avail> },
              {
                k: "Net from settlements",
                v: <Avail value={ledger}>{(l) => <span className={`font-mono ${l.totals.net > 0n ? "text-pass" : l.totals.net < 0n ? "text-fail" : ""}`}>{signed(l.totals.net)} MON</span>}</Avail>,
              },
            ]}
          />
        </Panel>
      </div>

      <Section
        title="Predictions and consequences"
        description="Every decision this agent took part in, newest first. The prediction is its final on-chain submission; the outcome and the settlement are what OutcomeRegistry recorded."
      >
        {ledger.status !== "ok" ? (
          <EmptyState title="Record unavailable">{ledger.reason}</EmptyState>
        ) : ledger.value.rows.length === 0 ? (
          <EmptyState title="No decisions yet">This agent has not participated in a decision on the deployed registry.</EmptyState>
        ) : (
          <>
            <Table caption="Agent ledger">
              <thead>
                <tr>
                  <Th>Decision</Th>
                  <Th>Predicted</Th>
                  <Th>Executed</Th>
                  <Th>Actual</Th>
                  <Th>Result</Th>
                  <Th align="right">Bond</Th>
                  <Th align="right">Penalty</Th>
                  <Th align="right">Reward</Th>
                  <Th align="right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.value.rows.map((r) => (
                  <tr key={r.decisionId}>
                    <Td mono className="whitespace-nowrap">
                      <Link href={`/decisions/${r.decisionId}#settlement`} className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                        #{r.decisionId}
                      </Link>
                      <span className="block text-[11px] text-ink-3">{r.resolvedAt ? formatUtc(r.resolvedAt).slice(0, 16) : r.status}</span>
                    </Td>
                    <Td mono className="whitespace-nowrap">
                      {r.choice ?? <span className="text-ink-3">none</span>}
                      {r.choice && <span className="block text-[11px] text-ink-3">score {r.score} · p {formatBps(r.probability ?? 0, 0)}</span>}
                    </Td>
                    <Td mono>{r.executed ?? <span className="text-ink-3">—</span>}</Td>
                    <Td mono>{r.observed ?? <span className="text-ink-3">{r.status === "RESOLVED" ? "void" : "pending"}</span>}</Td>
                    <Td>{r.result ? <StatusMark tone={tone(r.result)}>{r.result}</StatusMark> : <span className="text-[12px] text-ink-3">{r.status.toLowerCase()}</span>}</Td>
                    <Td align="right" mono>{formatMon(r.lock)}</Td>
                    <Td align="right" mono>{r.result ? formatMon(r.penalty) : "—"}</Td>
                    <Td align="right" mono>{r.result ? formatMon(r.reward) : "—"}</Td>
                    <Td align="right" mono className={r.net > 0n ? "text-pass" : r.net < 0n ? "text-fail" : ""}>
                      {r.result ? signed(r.net) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-[12.5px] text-ink-2">
              {ledger.value.totals.settled} settled: {ledger.value.totals.correct} correct, {ledger.value.totals.wrong} wrong, {ledger.value.totals.missed} missed,{" "}
              {ledger.value.totals.neutral} neutral · rewards {formatMon(ledger.value.totals.reward)} · penalties {formatMon(ledger.value.totals.penalty)} MON
              {ledger.value.truncated && ` · showing the latest ${ledger.value.scanned} decisions`}
            </p>
          </>
        )}
      </Section>
    </>
  );
}
