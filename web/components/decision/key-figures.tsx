import type { ReactNode } from "react";
import { StatusMark } from "@/components/ui/status";
import { formatBps, formatUtc } from "@/lib/format";
import type { DecisionView } from "@/lib/view/decision-view";

function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="label">{label}</p>
      <div className="mt-1.5 truncate font-mono text-[20px] leading-7 tabular">{value}</div>
      {note && <div className="mt-0.5 truncate text-[12px] text-ink-2">{note}</div>}
    </div>
  );
}

const muted = (s: string) => <span className="text-ink-3">{s}</span>;

/** The decision at a glance: what was chosen, how strongly, whether it passed, and what happened. */
export function KeyFigures({ v }: { v: DecisionView }) {
  const g = v.aggregation;
  const share = g?.supportShareBps ?? null;
  return (
    <div className="grid grid-cols-2 divide-rule border border-rule bg-surface sm:grid-cols-4 [&>*]:border-rule max-sm:[&>*:nth-child(odd)]:border-r max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:not(:nth-child(4n))]:border-r sm:[&>*:nth-child(n+5)]:border-t">
      <Figure label="Selected choice" value={g ? g.leading : muted("—")} note={g ? `${g.submissions} decisions aggregated` : "not aggregated"} />
      <Figure label="Aggregate score" value={g?.aggregateScore ?? muted("—")} note={`gate ${v.threshold.minActionScore} for actions`} />
      <Figure label="Aggregate probability" value={g?.aggregateProbability != null ? formatBps(g.aggregateProbability, 1) : muted("—")} note="mean of backers" />
      <Figure
        label="Threshold"
        value={share !== null ? formatBps(share, 1) : muted("—")}
        note={
          g ? (
            <StatusMark tone={g.passed ? "pass" : "fail"}>{g.passed ? `passed · ≥ ${formatBps(v.threshold.thresholdBps, 0)}` : `not met · ${formatBps(v.threshold.thresholdBps, 0)} req.`}</StatusMark>
          ) : (
            `${formatBps(v.threshold.thresholdBps, 0)} of weighted support`
          )
        }
      />
      <Figure label="Action" value={v.action ? v.action.fork : g?.guardianRequired ? "GUARDIAN" : muted("—")} note={v.action ? `${v.action.alias} · ${v.action.approvedBy}` : g?.guardianRequired ? "agents escalated" : "not approved"} />
      <Figure
        label="Execution"
        value={v.execution.status === "executed" ? "EXECUTED" : v.execution.status === "not-submitted" ? muted("NOT SUBMITTED") : v.execution.status === "awaiting" ? "AWAITING" : muted("—")}
        note={v.execution.status === "not-submitted" ? "simulation: no transaction" : v.execution.detail}
      />
      <Figure
        label="Outcome"
        value={
          v.outcome.status === "verified" ? (
            <span className={v.outcome.success ? "text-pass" : "text-fail"}>{v.outcome.observed}</span>
          ) : v.outcome.status === "void" ? (
            "VOID"
          ) : (
            muted(v.outcome.status === "na" ? "N/A" : "PENDING")
          )
        }
        note={v.outcome.status === "verified" ? `${v.outcome.success ? "success" : "miss"} · ${v.outcome.moveBps} bps` : v.outcome.detail}
      />
      <Figure
        label="Settlement"
        value={v.settlement.status === "na" ? muted("N/A") : v.settlement.status}
        note={v.outcome.resolvedAt ? formatUtc(v.outcome.resolvedAt) : v.settlement.detail}
      />
    </div>
  );
}
