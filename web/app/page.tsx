import Link from "next/link";
import { AgentTable } from "@/components/domain/agent-table";
import { DecisionTable } from "@/components/domain/decision-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { NotDeployed } from "@/components/domain/not-deployed";
import { ReadinessPanel } from "@/components/domain/readiness-panel";
import { LinkButton } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/status";
import { listAgents } from "@/lib/data/agents";
import { listDecisions } from "@/lib/data/decisions";
import { readiness } from "@/lib/data/readiness";

export const dynamic = "force-dynamic";

const LAYERS = [
  {
    name: "Jev",
    role: "Structures decisions",
    items: ["Hashed, sourced state", "Explicit questions and rubrics", "Choice · Score · Probability · Reason", "Parallel, batched, bounded"],
  },
  {
    name: "DecMarkt",
    role: "Makes decisions accountable",
    items: ["Agent identity and bonds", "Deterministic aggregation", "Threshold before any action", "Reward and penalty by rule"],
  },
  {
    name: "Monad",
    role: "Makes the result enforceable",
    items: ["Lifecycle in contract state", "Bounded execution only", "Oracle-verified outcome", "Public, auditable settlement"],
  },
];

export default async function DashboardPage() {
  const [decisions, agents] = await Promise.all([listDecisions(10), listAgents()]);
  const r = readiness();

  return (
    <>
      <PageHeader
        eyebrow="DecMarkt"
        title="AI decisions with on-chain accountability."
        lead="Five independent analysts decide on a hashed state. Their decisions are bonded, aggregated by deterministic rules, executed only within bounded actions, and settled against a verified outcome on Monad."
        aside={
          <div className="flex gap-3">
            <LinkButton href="/demo" variant="primary">Open live demo</LinkButton>
            <LinkButton href="/how-it-works">How it works</LinkButton>
          </div>
        }
      />

      <div className="mb-14 grid border border-rule bg-surface md:grid-cols-3">
        {LAYERS.map((l, i) => (
          <div key={l.name} className={`px-5 py-5 ${i > 0 ? "border-t border-rule md:border-l md:border-t-0" : ""}`}>
            <p className="label">Layer {i + 1}</p>
            <p className="mt-2 text-[17px] font-medium">{l.name}</p>
            <p className="text-ink-2">{l.role}</p>
            <ul className="mt-4 space-y-1.5 text-[13px]">
              {l.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span aria-hidden className="mt-[9px] inline-block h-px w-3 shrink-0 bg-ink-3" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Section index="01" title="Latest decisions" aside={<Link href="/decisions" className="text-[13px] text-ink-2 hover:text-ink">All decisions</Link>}>
            {decisions.status === "unavailable" ? (
              <>
                <div className="mb-4">
                  <LifecycleRail />
                </div>
                <NotDeployed what="decisions" />
              </>
            ) : decisions.value.length === 0 ? (
              <EmptyState title="No decisions recorded">
                The contracts are live but no decision has been created. Start one from the demo.
              </EmptyState>
            ) : (
              <DecisionTable rows={decisions.value} />
            )}
          </Section>

          <Section index="02" title="Agents" aside={<Link href="/agents" className="text-[13px] text-ink-2 hover:text-ink">Agent records</Link>}>
            <AgentTable agents={agents} />
          </Section>
        </div>

        <aside>
          <ReadinessPanel r={r} />
          <p className="mt-3 text-[12px] leading-5 text-ink-3">
            Presence of configuration only. Secrets are never sent to the browser.
          </p>
        </aside>
      </div>
    </>
  );
}
