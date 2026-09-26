import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { formatMon } from "@/lib/format";
import type { AgentView } from "@/lib/data/agents";

/** Agent identity and accountability record. On-chain columns are blank until read from chain. */
export function AgentTable({ agents, showMandate = false }: { agents: AgentView[]; showMandate?: boolean }) {
  return (
    <Table caption="Agents">
      <thead>
        <tr>
          <Th>ID</Th>
          <Th>Agent</Th>
          <Th>Primary question</Th>
          {showMandate && <Th>Mandate</Th>}
          <Th>Operator</Th>
          <Th align="right">Bond (MON)</Th>
          <Th align="right">Locked</Th>
          <Th align="right">Correct / resolved</Th>
          <Th align="right">Missed</Th>
        </tr>
      </thead>
      <tbody>
        {agents.map(({ spec, onChain }) => (
          <tr key={spec.key}>
            <Td mono className="text-ink-3">{spec.agentId}</Td>
            <Td className="whitespace-nowrap font-medium">{spec.name}</Td>
            <Td mono className="text-ink-2">{spec.primaryQuestion}</Td>
            {showMandate && <Td className="min-w-[320px] text-ink-2">{spec.mandate}</Td>}
            <Td>
              <Avail value={onChain}>{(a) => <Hash value={a.operator} href={explorer.address(a.operator)} />}</Avail>
            </Td>
            <Td align="right" mono>
              <Avail value={onChain}>{(a) => formatMon(a.bond)}</Avail>
            </Td>
            <Td align="right" mono>
              <Avail value={onChain}>{(a) => formatMon(a.locked)}</Avail>
            </Td>
            <Td align="right" mono>
              <Avail value={onChain}>{(a) => `${a.correct} / ${a.submitted}`}</Avail>
            </Td>
            <Td align="right" mono>
              <Avail value={onChain}>{(a) => a.missed}</Avail>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
