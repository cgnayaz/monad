import type { Metadata } from "next";
import { Demo } from "@/components/demo/demo";
import { PageHeader } from "@/components/ui/layout";
import { collectState } from "@/lib/collectors";
import { readiness } from "@/lib/data/readiness";
import { DEMO_PARAMETERS } from "@/lib/engine/runtime";
import { toWireJson } from "@/lib/engine/wire";
import { buildQuestionSet } from "@/lib/jev/questions";
import { fromRound } from "@/lib/view/decision-view";

export const metadata: Metadata = { title: "Demo" };
export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const state = await collectState();
  const questions = buildQuestionSet(state, state.timestamp);
  // What exists before any round: the current snapshot and the questions it generates.
  const idle = fromRound({
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
        eyebrow="Demo"
        title="One decision, from state to settlement"
        lead="Jev structures the decision. Five agents evaluate the state in parallel. DecMarkt aggregates their output with fixed rules and makes it accountable. Monad executes and records the action, and the observed outcome settles every bond."
      />
      <Demo modes={r.modes} idle={idle} allowedForks={DEMO_PARAMETERS.allowedForks} />
    </>
  );
}
