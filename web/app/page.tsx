import Link from "next/link";
import { AskPanel } from "@/components/ask/ask-panel";
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
  if (!latest) return { view: null, note: "Zincire henüz karar kaydedilmedi." };
  const c = await chainDecision(latest.id);
  if (c.status !== "ok" || !c.value) return { view: null, note: c.status === "unavailable" ? c.reason : "Karar bulunamadı." };
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
  const r = await readiness();

  return (
    <>
      <PageHeader
        eyebrow="DecMarkt · Monad Testnet"
        title="Zincir üstünde hesap verebilir AI kararları."
        lead="Jev her kararı yapılandırır. DecMarkt kararı veren ajanları teminata bağlar ve çıktılarına sabit kurallar uygular. Monad sınırlı eylemi uygular ve doğrulanmış sonucu kaydeder."
        aside={
          <div className="flex gap-3">
            <LinkButton href="/demo" variant="primary">
              Tur çalıştır
            </LinkButton>
            <LinkButton href="/how-it-works">Nasıl çalışır</LinkButton>
          </div>
        }
      />

      <Section title="Soru sor" description="Sistemin ne yaptığını merak ettiğiniz her şeyi sorun; yanıtları Gemini projenin kendi belgelerine dayanarak verir.">
        <AskPanel />
      </Section>

      <Section title="Güncel karar">
        <CurrentDecision chain={chain.view} chainNote={chain.note} />
      </Section>

      <Section
        title="Güncel durum"
        description="Şimdi Pyth, Monad ve DecMarkt kontratlarından toplandı. Bir sonraki tur, hiçbir ajan çalışmadan önce tam olarak bu anlık görüntüyü (aşağıdaki hash) zincire işler."
        aside={
          <Link href="/demo" className="text-[13px] text-ink-2 hover:text-ink">
            Bir turda kullan →
          </Link>
        }
      >
        <div className="space-y-8">
          <div className="min-w-0">
            <h3 className="mb-2.5 text-[13px] font-semibold">Durum</h3>
            <StatePanel v={snapshot} />
          </div>
          <div className="min-w-0">
            <h3 className="mb-2.5 text-[13px] font-semibold">Bundan üretilen sorular</h3>
            <QuestionsPanel v={snapshot} />
          </div>
        </div>
      </Section>

      <Section title="Sistem" description="Bir turun şu anda neler yapabildiği. Yalnızca yapılandırmanın varlığı gösterilir; gizli değerler asla tarayıcıya ulaşmaz.">
        <div className="max-w-[640px]">
          <ReadinessPanel r={r} />
        </div>
      </Section>
    </>
  );
}
