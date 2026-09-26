import type { JevStage, JevStageState } from "@/lib/view/decision-view";

const bar: Record<JevStageState, string> = {
  done: "bg-ink",
  active: "bg-accent",
  failed: "bg-fail",
  pending: "bg-transparent",
  na: "bg-transparent",
};
const label: Record<JevStageState, string> = {
  done: "text-ink",
  active: "text-accent",
  failed: "text-fail",
  pending: "text-ink-3",
  na: "text-ink-3",
};

/**
 * The Jev lifecycle as it applies to this decision: every cell shows the value produced at
 * that stage (or that it has not happened yet). Horizontal on wide screens, a vertical list
 * on narrow ones.
 */
export function JevTrack({ stages }: { stages: JevStage[] }) {
  return (
    <ol aria-label="Jev yaşam döngüsü" className="grid grid-cols-1 border border-rule bg-surface md:grid-cols-3 2xl:grid-cols-6">
      {stages.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.state === "active" ? "step" : undefined}
          className={`relative min-w-0 border-rule px-4 pb-3.5 pt-4 max-md:[&:not(:last-child)]:border-b md:max-2xl:[&:nth-child(-n+3)]:border-b md:[&:not(:nth-child(3n))]:border-r 2xl:[&:nth-child(3)]:border-r 2xl:[&:not(:last-child)]:border-r ${
            s.state === "na" ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--surface-2)_6px_7px)]" : ""
          } ${s.state === "active" ? "dm-progress" : ""}`}
        >
          <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 transition-colors duration-150 ${bar[s.state]}`} />
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[11px] font-medium uppercase tracking-[0.06em] ${label[s.state]}`}>
              <span className="mr-1.5 font-mono text-ink-3">{i + 1}</span>
              {s.label}
            </span>
            <span className="sr-only">{s.state}</span>
            {i < stages.length - 1 && (
              <span aria-hidden className="hidden font-mono text-[11px] text-ink-3 2xl:inline">
                →
              </span>
            )}
          </div>
          <p className={`mt-2 truncate font-mono text-[14px] leading-5 ${s.state === "pending" ? "text-ink-3" : "text-ink"}`} title={s.primary}>
            {s.primary}
          </p>
          <p className="mt-0.5 min-h-[18px] truncate text-[12px] text-ink-2" title={s.secondary}>
            {s.secondary ?? ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
