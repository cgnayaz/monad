import type { Metadata } from "next";
import { DecisionTable } from "@/components/domain/decision-table";
import { NotDeployed } from "@/components/domain/not-deployed";
import { PageHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/status";
import { listDecisions } from "@/lib/data/decisions";

export const metadata: Metadata = { title: "Decisions" };
export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const decisions = await listDecisions(100);
  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Decisions"
        lead="Every decision recorded in DecisionRegistry, newest first. Open one for the full audit trail: state, questions, each agent's decision, aggregation, action, outcome and settlement."
      />
      {decisions.status === "unavailable" ? (
        decisions.reason.startsWith("Contracts") ? (
          <NotDeployed what="decisions" />
        ) : (
          <EmptyState title="Decisions unavailable">{decisions.reason}</EmptyState>
        )
      ) : decisions.value.length === 0 ? (
        <EmptyState title="No decisions recorded">No decision has been created on the deployed registry yet.</EmptyState>
      ) : (
        <DecisionTable rows={decisions.value} />
      )}
    </>
  );
}
