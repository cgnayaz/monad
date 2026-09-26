import { StatusMark } from "@/components/ui/status";
import type { Readiness } from "@/lib/data/readiness";

const ROWS: { key: "contracts" | "oracle" | "ai" | "signers"; label: string }[] = [
  { key: "contracts", label: "Contracts" },
  { key: "oracle", label: "Oracle" },
  { key: "ai", label: "AI provider" },
  { key: "signers", label: "Signers" },
];

export function ReadinessPanel({ r }: { r: Readiness }) {
  return (
    <div className="border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <span className="text-[13px] font-semibold">Live round readiness</span>
        <StatusMark tone={r.ready ? "pass" : "wait"}>{r.ready ? "ready" : "not ready"}</StatusMark>
      </div>
      <ul>
        {ROWS.map(({ key, label }) => (
          <li key={key} className="grid grid-cols-[110px_1fr] items-baseline gap-3 border-b border-rule px-4 py-2.5 last:border-b-0">
            <StatusMark tone={r[key].ok ? "pass" : "neutral"}>{label}</StatusMark>
            <span className="min-w-0 break-words text-[13px] text-ink-2">{r[key].detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
