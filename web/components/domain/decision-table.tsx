import Link from "next/link";
import { StatusMark, type Tone } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import type { DecisionSummary } from "@/lib/data/decisions";
import { formatUtc, shortHex } from "@/lib/format";
import type { Status } from "@/lib/types/protocol";

export function statusTone(s: Status): Tone {
  if (s === "RESOLVED") return "pass";
  if (s === "CANCELLED") return "fail";
  return "wait";
}

export function DecisionTable({ rows }: { rows: DecisionSummary[] }) {
  return (
    <Table caption="Decisions">
      <thead>
        <tr>
          <Th>ID</Th>
          <Th>Status</Th>
          <Th>State hash</Th>
          <Th align="right">Participants</Th>
          <Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id.toString()} className="hover:bg-surface-2">
            <Td mono>
              <Link href={`/decisions/${d.id}`} className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                #{d.id.toString()}
              </Link>
            </Td>
            <Td>
              <StatusMark tone={statusTone(d.status)}>{d.status}</StatusMark>
            </Td>
            <Td mono className="text-ink-2">{shortHex(d.stateHash)}</Td>
            <Td align="right" mono>{d.participants}</Td>
            <Td mono className="text-ink-2">{formatUtc(d.createdAt)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
