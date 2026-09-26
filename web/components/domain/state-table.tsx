import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import type { StateInput } from "@/lib/jev/state";
import { formatUtc } from "@/lib/format";

function formatValue(i: StateInput): string {
  if (i.value === null) return "—";
  if (typeof i.value === "number") return i.value.toLocaleString("en-US", { maximumSignificantDigits: 8 });
  return i.value;
}

/** Every Jev state input with its source and status. Unavailable inputs stay visible with a reason. */
export function StateTable({ inputs }: { inputs: StateInput[] }) {
  return (
    <Table caption="Jev state inputs">
      <thead>
        <tr>
          <Th>Input</Th>
          <Th align="right">Value</Th>
          <Th>Unit</Th>
          <Th>Source</Th>
          <Th>Reference</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {inputs.map((i) => (
          <tr key={i.key}>
            <Td mono>{i.key}</Td>
            <Td align="right" mono className={i.status === "ok" ? "" : "text-ink-3"}>
              {formatValue(i)}
            </Td>
            <Td className="text-ink-2">{i.unit ?? ""}</Td>
            <Td className="whitespace-nowrap text-ink-2">{i.source}</Td>
            <Td mono className="text-ink-2" title={formatUtc(i.observedAt)}>
              {i.sourceRef ?? ""}
            </Td>
            <Td>
              {i.status === "ok" ? (
                <StatusMark tone="pass">ok</StatusMark>
              ) : (
                <span className="flex flex-col gap-0.5">
                  <StatusMark tone={i.status === "stale" ? "wait" : "neutral"}>{i.status}</StatusMark>
                  {i.note && <span className="text-[12px] text-ink-3">{i.note}</span>}
                </span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
