import { StatusMark } from "@/components/ui/status";
import { explorer } from "@/lib/chain/monad";
import { shortHex } from "@/lib/format";
import type { ProvenanceStep } from "@/lib/model/provenance";

const tone = { present: "pass", "reference-only": "wait", pending: "neutral" } as const;
const label = { present: "mevcut", "reference-only": "yalnız hash", pending: "bekliyor" } as const;

const STAGE_TR: Record<string, string> = {
  STATE: "DURUM",
  QUESTION: "SORU",
  AGENT: "AJAN",
  DECISION: "KARAR",
  AGGREGATION: "TOPLAMA",
  ACTION: "EYLEM",
  TRANSACTION: "İŞLEM",
  OUTCOME: "SONUÇ",
  SETTLEMENT: "UZLAŞMA",
};

/** One agent's decision traced from state to settlement (DATA_MODEL.md §6). */
export function ProvenanceTrail({ steps }: { steps: ProvenanceStep[] }) {
  return (
    <ol className="border border-rule bg-surface">
      {steps.map((s, i) => (
        <li key={s.stage} className="grid grid-cols-[28px_1fr] gap-x-3 border-b border-rule px-4 py-2.5 last:border-b-0 md:grid-cols-[28px_120px_1fr_110px_120px]">
          <span className="font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
          <span className="text-[11px] font-medium tracking-[0.06em] text-ink-2">{STAGE_TR[s.stage] ?? s.stage}</span>
          <span className="col-start-2 min-w-0 break-words font-mono text-[12px] md:col-start-auto">
            {s.ref}
            {s.hash && <span className="ml-2 text-ink-3" title={s.hash}>{shortHex(s.hash)}</span>}
          </span>
          <span className="col-start-2 font-mono text-[11.5px] md:col-start-auto">
            {s.tx ? (
              <a href={explorer.tx(s.tx.hash)} target="_blank" rel="noreferrer" title={`${s.tx.contract}.${s.tx.functionName}`} className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                {shortHex(s.tx.hash, 4, 4)}
              </a>
            ) : null}
          </span>
          <span className="col-start-2 md:col-start-auto md:text-right">
            <StatusMark tone={tone[s.status]}>{label[s.status]}</StatusMark>
          </span>
        </li>
      ))}
    </ol>
  );
}
