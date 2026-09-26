import Link from "next/link";
import { CurrentDecision } from "@/components/decision/current-decision";
import { QuestionsPanel, StatePanel } from "@/components/decision/panels";
import { ReadinessPanel } from "@/components/domain/readiness-panel";
import { LinkButton } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui/layout";
import { collectState } from "@/lib/collectors";
import { chainDecision } from "@/lib/data/decision-view";
import { listDecisions } from "@/lib/data/decisions";
import { readiness } from "@/lib/data/readiness";
import { toWireJson } from "@/lib/engine/wire";
import { buildQuestionSet } from "@/lib/jev/questions";
import { fromRound, type DecisionView } from "@/lib/view/decision-view";

export const dynamic = "force-dynamic";

async function latestChainDecision(): Promise<{ view: DecisionView | null; note: string }> {
  const list = await listDecisions(1);
  if (list.status === "unavailable") return { view: null, note: `${list.reason}.` };
  const latest = list.value[0];
  if (!latest) return { view: null, note: "No decision has been recorded on-chain yet." };
  const c = await chainDecision(latest.id);
  if (c.status !== "ok" || !c.value) return { view: null, note: c.status === "unavailable" ? c.reason : "Decision not found." };
  return { view: c.value.view, note: "" };
}

export default async function DashboardPage() {
  const [chain, state] = await Promise.all([latestChainDecision(), collectState()]);
  const questions = buildQuestionSet(state, state.timestamp);
  const snapshot = fromRound({
    state: JSON.parse(toWireJson(state)),
    questions: JSON.parse(toWireJson(questions)),
    runs: {},
    running: {},
    submissions: {},
    decision: null,
  });
  const r = readiness();

  return (
    <>
      <PageHeader
        eyebrow="DecMarkt · Monad Testnet"
        title="AI decisions with on-chain accountability."
        lead="Jev structures each decision. DecMarkt bonds the agents that make it and applies fixed rules to their output. Monad enforces the bounded action and records the verified outcome."
        aside={
          <div className="flex gap-3">
            <LinkButton href="/demo" variant="primary">
              Run a round
            </LinkButton>
            <LinkButton href="/how-it-works">How it works</LinkButton>
          </div>
        }
      />

      <Section title="Current decision">
        <CurrentDecision chain={chain.view} chainNote={chain.note} />
      </Section>

      <Section
        title="Current state"
        description="Collected now from Pyth, Monad and the DecMarkt contracts. The next round commits exactly this snapshot (hash below) before any agent runs."
        aside={
          <Link href="/demo" className="text-[13px] text-ink-2 hover:text-ink">
            Use it in a round →
          </Link>
        }
      >
        <div className="space-y-8">
          <div className="min-w-0">
            <h3 className="mb-2.5 text-[13px] font-semibold">State</h3>
            <StatePanel v={snapshot} />
          </div>
          <div className="min-w-0">
            <h3 className="mb-2.5 text-[13px] font-semibold">Questions generated from it</h3>
            <QuestionsPanel v={snapshot} />
          </div>
        </div>
      </Section>

      <Section title="System" description="What a round can do right now. Presence of configuration only; secrets never reach the browser.">
        <div className="max-w-[640px]">
          <ReadinessPanel r={r} />
        </div>
      </Section>
    </>
  );
}
