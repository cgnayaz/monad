import type { Metadata } from "next";
import { AskPanel } from "@/components/ask/ask-panel";
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
      <section aria-label="Bu demo ne yapıyor" className="mb-10 grid grid-cols-1 border border-rule bg-surface md:grid-cols-3">
        <div className="border-rule px-5 py-4 max-md:border-b md:border-r">
          <p className="label">Sorun</p>
          <p className="mt-1.5 text-[13.5px] leading-[21px]">
            AI ajanları giderek parayı etkileyen kararlar veriyor. Yanıldıklarında bedelini kimse ödemiyor ve kararın neye dayandığı sonradan
            doğrulanamıyor.
          </p>
        </div>
        <div className="border-rule px-5 py-4 max-md:border-b md:border-r">
          <p className="label">DecMarkt ne yapıyor</p>
          <ul className="mt-1.5 space-y-1 text-[13.5px] leading-[21px]">
            <li>1. Beş bağımsız AI analisti aynı veriye bakıp ayrı ayrı karar verir.</li>
            <li>2. Her biri kararının arkasına teminat koyar.</li>
            <li>3. Sabit kurallar kararları birleştirir; yeterli uzlaşı yoksa hiçbir şey yapılmaz.</li>
            <li>4. Gerçek fiyat hareketi kimin haklı olduğunu belirler: haklı olan ödül, yanılan ceza alır.</li>
          </ul>
        </div>
        <div className="px-5 py-4">
          <p className="label">Bu turun sorusu</p>
          <p className="mt-1.5 text-[15px] font-medium leading-[22px]">“Kasa önümüzdeki {DEMO_PARAMETERS.horizon} saniye için ne yapmalı?”</p>
          <p className="mt-1.5 text-[12.5px] text-ink-2">
            Seçenekler: riski azalt (DERISK), bekle (NO_ACTION), fon konuşlandır (DEPLOY) ya da insana sor (ESCALATE). Doğru cevabı sonradan ETH/USD
            fiyatının gerçek hareketi belirler.
          </p>
        </div>
      </section>
      <div className="mb-10">
        <p className="mb-2.5 text-[13px] font-semibold">Soru sor</p>
        <AskPanel />
      </div>
      <Demo modes={r.modes} idle={idle} allowedForks={DEMO_PARAMETERS.allowedForks} />
    </>
  );
}
