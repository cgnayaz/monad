import type { ReactNode } from "react";

export type Tone = "pass" | "fail" | "wait" | "neutral" | "accent";

const markTone: Record<Tone, string> = {
  pass: "bg-pass",
  fail: "bg-fail",
  wait: "bg-wait",
  neutral: "bg-ink-3",
  accent: "bg-accent",
};
const textTone: Record<Tone, string> = {
  pass: "text-pass",
  fail: "text-fail",
  wait: "text-wait",
  neutral: "text-ink-2",
  accent: "text-accent",
};

/** Small-caps text with a 6 px square marker. Not a pill. `live` blinks the marker while in flight. */
export function StatusMark({ tone, children, live = false }: { tone: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.06em] ${textTone[tone]}`}>
      <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 ${markTone[tone]} ${live ? "dm-pending" : ""}`} />
      {children}
    </span>
  );
}

/** An explicitly unavailable value. Never a placeholder number. */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <span className="cursor-help text-ink-3" title={reason}>
      —<span className="sr-only"> unavailable: {reason}</span>
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-rule px-6 py-10">
      <p className="text-[15px] font-medium">{title}</p>
      {children && <div className="mt-2 max-w-[64ch] text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
