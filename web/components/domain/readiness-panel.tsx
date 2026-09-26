import { StatusMark } from "@/components/ui/status";
import type { Readiness } from "@/lib/data/readiness";

const ROWS: { key: "contracts" | "oracle" | "ai" | "signers"; label: string }[] = [
  { key: "contracts", label: "Kontratlar" },
  { key: "oracle", label: "Oracle" },
  { key: "ai", label: "AI sağlayıcı" },
  { key: "signers", label: "İmzacılar" },
];

export function ReadinessPanel({ r }: { r: Readiness }) {
  return (
    <div className="border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="text-[13px] font-semibold">Canlı tur hazırlığı</span>
        <StatusMark tone={r.ready ? "pass" : "wait"}>{r.ready ? "hazır" : "hazır değil"}</StatusMark>
      </div>
      <ul>
        {ROWS.map(({ key, label }) => (
          <li key={key} className="grid grid-cols-[110px_1fr] items-baseline gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
            <StatusMark tone={r[key].ok ? "pass" : "neutral"}>{label}</StatusMark>
            <span className="min-w-0 break-words text-[13px] text-ink-2">{r[key].detail}</span>
          </li>
        ))}
      </ul>
      {r.invalidEnv.length > 0 && (
        <p className="border-t border-rule px-4 py-2.5 text-[12.5px] text-fail">
          Geçersiz biçimli olduğu için yok sayılan değişkenler: <span className="font-mono">{r.invalidEnv.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
