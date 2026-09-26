import type { Metadata } from "next";
import Link from "next/link";
import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { PageHeader, Section } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { listAgents } from "@/lib/data/agents";
import { DEFAULT_PARAMS } from "@/lib/decmarkt/params";
import { formatBps, formatMon } from "@/lib/format";
import { QUESTION_TEMPLATES, DEFAULT_ASSIGNMENT } from "@/lib/jev/questions";
import { DOMAIN_LABEL } from "@/lib/view/decision-view";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await listAgents();
  const p = DEFAULT_PARAMS;
  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Agents"
        lead="Five analytical modules with separate responsibilities. Each is an on-chain identity with its own operator address and bond; its accuracy is recorded by the contracts after every verified outcome and becomes its voting weight."
      />

      <Section title="Modules">
        <ol className="border border-rule bg-surface">
          {agents.map(({ spec, onChain }) => {
            const primary = QUESTION_TEMPLATES.find((q) => q.category === spec.primaryQuestion)!;
            const totalWeight = primary.rubric.reduce((t, f) => t + f.weight, 0);
            return (
              <li key={spec.key} className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-rule px-5 py-5 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
                <div>
                  <p className="font-mono text-[11px] text-ink-3">agent {spec.agentId}</p>
                  <Link href={`/agents/${spec.agentId}`} className="text-[15px] font-medium underline decoration-rule underline-offset-2 hover:decoration-ink">
                    {spec.name}
                  </Link>
                  <p className="text-[12.5px] text-ink-2">{DOMAIN_LABEL[spec.key]}</p>
                </div>
                <div className="min-w-0 space-y-3">
                  <p className="text-[13.5px] leading-[21px]">{spec.mandate}</p>
                  <div>
                    <p className="label">Answers</p>
                    <p className="mt-1 text-[13px] text-ink-2">
                      <span className="font-mono text-ink">Q{primary.index}</span> {primary.text} <span className="text-ink-3">· and Q0, the action question</span>
                    </p>
                  </div>
                  <div>
                    <p className="label">Rubric (score = weighted ratings 0–4 → 0–10000)</p>
                    <ul className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 text-[12.5px] text-ink-2 sm:grid-cols-2">
                      {primary.rubric.map((f) => (
                        <li key={f.factor} className="flex justify-between gap-3">
                          <span className="font-mono text-ink">{f.factor}</span>
                          <span className="font-mono text-ink-3">
                            {f.weight}/{totalWeight}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-2 text-[12.5px] lg:grid-cols-1">
                  <div>
                    <dt className="label">Operator</dt>
                    <dd className="mt-0.5">
                      <Avail value={onChain}>{(a) => <Hash value={a.operator} href={explorer.address(a.operator)} />}</Avail>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Status</dt>
                    <dd className="mt-0.5">
                      <Avail value={onChain}>{(a) => <StatusMark tone={a.active ? "pass" : "neutral"}>{a.active ? "active" : "inactive"}</StatusMark>}</Avail>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Bond · locked (MON)</dt>
                    <dd className="mt-0.5 font-mono">
                      <Avail value={onChain}>{(a) => `${formatMon(a.bond, 3)} · ${formatMon(a.locked, 3)}`}</Avail>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Correct / resolved · missed</dt>
                    <dd className="mt-0.5 font-mono">
                      <Avail value={onChain}>{(a) => `${a.correct} / ${a.submitted} · ${a.missed}`}</Avail>
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
        {agents.some((a) => a.onChain.status !== "ok") && (
          <p className="mt-3 text-[12.5px] text-ink-3">On-chain fields are blank until the agents are registered on a deployed DecisionRegistry.</p>
        )}
        <p className="mt-3 text-[12.5px] text-ink-3">
          Assignment: {Object.entries(DEFAULT_ASSIGNMENT).map(([k, q]) => `${k} → Q${q.join(", Q")}`).join(" · ")}
        </p>
      </Section>

      <Section
        title="Settlement"
        description={`Per decision each participant locks ${formatMon(p.lockPerAgent, 2)} MON. OutcomeRegistry settles every bond from the verified outcome; agents have no input into it.`}
      >
        <Table caption="Settlement rules">
          <thead>
            <tr>
              <Th>Result</Th>
              <Th>Condition</Th>
              <Th>Penalty</Th>
              <Th>Reward</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td mono>CORRECT</Td>
              <Td>Final choice equals the fork the observed move made correct</Td>
              <Td>none</Td>
              <Td>Share of penalties + round reward, by probability</Td>
            </tr>
            <tr>
              <Td mono>WRONG</Td>
              <Td>NO_ACTION, DERISK or DEPLOY, and not the correct fork</Td>
              <Td className="font-mono">bond × {formatBps(p.slashBps, 0)} × probability</Td>
              <Td>none</Td>
            </tr>
            <tr>
              <Td mono>NEUTRAL</Td>
              <Td>ESCALATE</Td>
              <Td>none</Td>
              <Td>none</Td>
            </tr>
            <tr>
              <Td mono>MISSED</Td>
              <Td>No valid final decision before the deadline</Td>
              <Td className="font-mono">bond × {formatBps(p.missPenaltyBps, 0)}</Td>
              <Td>none</Td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Voting weight" description="Probability multiplied by Laplace-smoothed on-chain accuracy. A new agent starts at 50 %; accuracy moves its weight up or down.">
        <pre className="overflow-x-auto border border-rule bg-surface px-4 py-3 font-mono text-[12.5px] leading-5">
{`rep_i  = (correct_i + 1) × 10000 / (resolved_i + 2)
w_i    = probability_i × rep_i / 10000
support[choice_i] += w_i`}
        </pre>
      </Section>
    </>
  );
}
