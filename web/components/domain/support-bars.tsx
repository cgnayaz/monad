import { FORKS } from "@/lib/types/protocol";

/**
 * Weighted support per fork, from DecisionEngine.getAggregation. The threshold is drawn
 * as a vertical rule; exact figures are printed beside each bar.
 */
export function SupportBars({ support, total, thresholdBps }: { support: bigint[]; total: bigint; thresholdBps: number }) {
  const pct = (v: bigint) => (total === 0n ? 0 : Number((v * 10_000n) / total) / 100);
  const threshold = thresholdBps / 100;
  return (
    <div className="border border-rule bg-surface px-4 py-4">
      <ul className="space-y-3">
        {FORKS.map((f, i) => {
          const p = pct(support[i] ?? 0n);
          return (
            <li key={f} className="grid grid-cols-[96px_1fr_72px] items-center gap-3">
              <span className="font-mono text-[12px]">{f}</span>
              <div className="relative h-3 bg-surface-2">
                <div className="h-full" style={{ width: `${p}%`, background: `var(--fork-${i})` }} />
                <div className="absolute inset-y-[-4px] w-px bg-accent" style={{ left: `${threshold}%` }} aria-hidden />
              </div>
              <span className="text-right font-mono text-[12px] tabular">{p.toFixed(2)} %</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[12px] text-ink-2">
        <span className="mr-2 inline-block h-2.5 w-px translate-y-0.5 bg-accent" aria-hidden />
        Threshold {threshold.toFixed(2)} % of total weighted support ({total.toString()}).
      </p>
    </div>
  );
}
