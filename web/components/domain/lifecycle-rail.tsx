import { explorer } from "@/lib/chain/monad";
import { shortHex } from "@/lib/format";
import { LIFECYCLE, STATUSES, type Hex, type Status } from "@/lib/types/protocol";

export interface Transition {
  status: Status;
  block: bigint;
  txHash: Hex | null;
}

/**
 * The seven-state lifecycle (CONTRACT_SPEC.md §3). Each reached step shows the block and
 * transaction that produced it. With no decision, the rail shows the lifecycle itself.
 */
export function LifecycleRail({ current, transitions = [] }: { current?: Status; transitions?: Transition[] }) {
  const cancelled = current === "CANCELLED";
  const currentIdx = current ? STATUSES.indexOf(current) : -1;
  return (
    <div>
      <ol className="grid grid-cols-2 border border-rule bg-surface sm:grid-cols-3 lg:grid-cols-6">
        {LIFECYCLE.map((s, i) => {
          const t = transitions.find((x) => x.status === s);
          const reached = !!t;
          const isCurrent = current === s;
          return (
            <li
              key={s}
              className={`relative border-rule px-4 py-3 [&:not(:last-child)]:border-r max-lg:[&:nth-child(n+3)]:border-t max-sm:[&:nth-child(2n)]:border-r-0 ${
                isCurrent ? "bg-surface-2" : ""
              }`}
            >
              <span
                aria-hidden
                className={`absolute inset-x-0 top-0 h-0.5 ${isCurrent ? "bg-accent" : reached ? "bg-ink" : "bg-transparent"}`}
              />
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <span className={`text-[12px] font-medium tracking-[0.04em] ${reached || isCurrent ? "text-ink" : "text-ink-3"}`}>{s}</span>
              </div>
              <div className="mt-1 min-h-[20px] font-mono text-[11.5px] text-ink-2">
                {t ? (
                  t.txHash ? (
                    <a href={explorer.tx(t.txHash)} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                      {shortHex(t.txHash, 4, 4)}
                    </a>
                  ) : (
                    <span>block {t.block.toString()}</span>
                  )
                ) : current && !cancelled && currentIdx >= 0 && STATUSES.indexOf(s) > currentIdx ? (
                  <span className="text-ink-3">pending</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {cancelled && (
        <p className="mt-2 text-[12px] text-fail">CANCELLED — bond locks released, no settlement.</p>
      )}
    </div>
  );
}
