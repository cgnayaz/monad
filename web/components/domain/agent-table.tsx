import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { formatMon } from "@/lib/format";
import type { AgentView } from "@/lib/data/agents";
import { AGENT_TR, agentName } from "@/lib/i18n";

/** Agent identity and accountability record. On-chain columns are blank until read from chain. */
export function AgentTable({ agents, showMandate = false }: { agents: AgentView[]; showMandate?: boolean }) {
  return (
    <Table caption="Ajanlar">
      <thead>
        <tr>
          <Th>ID</Th>
          <Th>Ajan</Th>
          <Th>Ana soru</Th>
          {showMandate && <Th>Görev tanımı</Th>}
          <Th>Operatör</Th>
          <Th align="right">Teminat (MON)</Th>
          <Th align="right">Kilitli</Th>
          <Th align="right">Doğru / sonuçlanan</Th>
          <Th align="right">Kaçırılan</Th>
        </tr>
      </thead>
      <tbody>
        {agents.map(({ spec, onChain }) => (
          <tr key={spec.key}>
            <Td mono className="text-ink-3">{spec.agentId}</Td>
            <Td className="whitespace-nowrap font-medium">{agentName(spec.key, spec.name)}</Td>
            <Td mono className="text-ink-2">{spec.primaryQuestion}</Td>
            {showMandate && <Td className="min-w-[320px] text-ink-2">{AGENT_TR[spec.key]?.mandate ?? spec.mandate}</Td>}
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
