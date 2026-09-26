import { Table, Td, Th } from "@/components/ui/table";
import { FORK_TR } from "@/lib/i18n";
import { FORK_SPECS } from "@/lib/jev/forks";
import { FORKS } from "@/lib/types/protocol";

/** The closed set of bounded forks. Nothing outside this table can execute. */
export function ForkTable() {
  return (
    <Table caption="Sınırlı çatallar">
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Çatal</Th>
          <Th>Kısa ad</Th>
          <Th>Kasaya etkisi</Th>
          <Th>Yürütme</Th>
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
              <Td className="min-w-[280px] text-ink-2">{FORK_TR[f].effect}</Td>
              <Td className="whitespace-nowrap">{s.executable ? "otomatik" : "guardian üzerinden"}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
