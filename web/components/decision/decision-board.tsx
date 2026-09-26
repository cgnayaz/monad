import type { ReactNode } from "react";
import type { DecisionView } from "@/lib/view/decision-view";
import { AgentModules } from "./agent-modules";
import { JevTrack } from "./jev-track";
import { KeyFigures } from "./key-figures";
import { ActionPanel, AggregationPanel, OutcomePanel, SettlementPanel } from "./panels";

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * A decision on one surface, in the order the protocol produces it: the Jev track, the
 * figures that matter, the five analysts, then aggregation → action → outcome → settlement.
 */
export function DecisionBoard({ v, header }: { v: DecisionView; header?: ReactNode }) {
  const failed = v.agents.filter((a) => a.status === "failed" || a.status === "missed").length;
  return (
    <div className="space-y-6">
      {header}
      <JevTrack stages={v.stages} />
      <KeyFigures v={v} />
      <Block title="Parallel decisions" aside={failed > 0 ? <span className="text-[12px] text-fail">{failed} agent(s) without a valid decision</span> : undefined}>
        <AgentModules agents={v.agents} />
      </Block>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AggregationPanel v={v} />
        <ActionPanel v={v} />
        <OutcomePanel v={v} />
        <SettlementPanel v={v} />
      </div>
    </div>
  );
}
