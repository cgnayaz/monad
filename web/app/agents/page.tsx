import type { Metadata } from "next";
import { AgentTable } from "@/components/domain/agent-table";
import { PageHeader, Section } from "@/components/ui/layout";
import { Table, Td, Th } from "@/components/ui/table";
import { listAgents } from "@/lib/data/agents";
import { DEFAULT_PARAMS } from "@/lib/decmarkt/params";
import { formatBps, formatMon } from "@/lib/format";

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
        lead="Each analyst is a separate on-chain identity with its own operator address and bond. Accuracy is recorded by the contracts after each verified outcome and becomes voting weight in later decisions."
      />

      <Section index="01" title="Roster">
        <AgentTable agents={agents} showMandate />
      </Section>

      <Section
        index="02"
        title="How agents are settled"
        description={`Per decision, each participant locks ${formatMon(p.lockPerAgent)} MON. Settlement is computed by OutcomeRegistry from the verified outcome; agents have no input into it.`}
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
              <Td>Choice equals the correct fork</Td>
              <Td>none</Td>
              <Td>Share of penalties + round reward, weighted by probability</Td>
            </tr>
            <tr>
              <Td mono>WRONG</Td>
              <Td>Choice is NO_ACTION, DERISK or DEPLOY and differs from the correct fork</Td>
              <Td>lock × {formatBps(p.slashBps, 0)} × probability</Td>
              <Td>none</Td>
            </tr>
            <tr>
              <Td mono>NEUTRAL</Td>
              <Td>Choice is ESCALATE</Td>
              <Td>none</Td>
              <Td>none</Td>
            </tr>
            <tr>
              <Td mono>MISSED</Td>
              <Td>No valid submission before the deadline</Td>
              <Td>lock × {formatBps(p.missPenaltyBps, 0)}</Td>
              <Td>none</Td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section index="03" title="Voting weight" description="Weight in aggregation is the agent's probability multiplied by its Laplace-smoothed accuracy, (correct + 1) / (resolved + 2). A new agent starts at 50 %.">
        <pre className="overflow-x-auto border border-rule bg-surface px-4 py-3 font-mono text-[12.5px] leading-5">
{`rep_i  = (correct_i + 1) × 10000 / (resolved_i + 2)
w_i    = probability_i × rep_i / 10000
support[choice_i] += w_i`}
        </pre>
      </Section>
    </>
  );
}
