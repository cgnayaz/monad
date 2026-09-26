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
        title="Tek karar: durumdan uzlaşmaya"
        lead="Jev kararı yapılandırır. Beş ajan durumu paralel olarak değerlendirir. DecMarkt çıktılarını sabit kurallarla toplar ve hesap verebilir kılar. Monad eylemi yürütür ve kaydeder; gözlenen sonuç her teminatı uzlaştırır."
      />
      <Demo modes={r.modes} idle={idle} allowedForks={DEMO_PARAMETERS.allowedForks} />
    </>
  );
}
