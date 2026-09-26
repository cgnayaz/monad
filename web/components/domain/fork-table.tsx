import { Table, Td, Th } from "@/components/ui/table";
import { FORK_SPECS } from "@/lib/jev/forks";
import { FORKS } from "@/lib/types/protocol";

/** The closed set of bounded forks. Nothing outside this table can execute. */
export function ForkTable() {
  return (
    <Table caption="Bounded forks">
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Fork</Th>
          <Th>Brief alias</Th>
          <Th>Effect on the vault</Th>
          <Th>Executes</Th>
        </tr>
      </thead>
      <tbody>
        {FORKS.map((f, i) => {
          const s = FORK_SPECS[f];
          return (
            <tr key={f}>
              <Td mono className="text-ink-3">{i}</Td>
              <Td mono>{f}</Td>
              <Td mono className="text-ink-2">{s.alias}</Td>
              <Td className="min-w-[280px] text-ink-2">{s.effect}</Td>
              <Td className="whitespace-nowrap">{s.executable ? "automatically" : "via guardian"}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
