import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentModules } from "@/components/decision/agent-modules";
import { JevTrack } from "@/components/decision/jev-track";
import { KeyFigures } from "@/components/decision/key-figures";
import {
  ActionPanel,
  AggregationPanel,
  IntegrityPanel,
  OutcomePanel,
  QuestionsPanel,
  SettlementPanel,
  StatePanel,
  TransitionsTable,
} from "@/components/decision/panels";
import { statusTone } from "@/components/domain/decision-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { NotDeployed } from "@/components/domain/not-deployed";
import { ProvenanceTrail } from "@/components/domain/provenance-trail";
import { Hash } from "@/components/ui/hash";
import { PageHeader, Section } from "@/components/ui/layout";
import { EmptyState, StatusMark } from "@/components/ui/status";
import { LifecycleActions } from "@/components/wallet/lifecycle-actions";
import { explorer } from "@/lib/chain/monad";
import { chainDecision } from "@/lib/data/decision-view";
import { formatDuration, formatMon, formatUtc } from "@/lib/format";
import { maskToForks } from "@/lib/jev/forks";
import { traceDecision, validateProvenance } from "@/lib/model/provenance";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/decisions/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Karar #${id}` };
}

const SECTIONS = [
  ["state", "Durum"],
  ["questions", "Sorular"],
  ["decisions", "Ajan kararları"],
  ["aggregation", "Toplama"],
  ["action", "Eylem"],
  ["transactions", "İşlemler"],
  ["outcome", "Sonuç"],
  ["settlement", "Hesap verebilirlik"],
  ["integrity", "Bütünlük"],
  ["provenance", "Köken izi"],
] as const;

export default async function DecisionPage(props: PageProps<"/decisions/[id]">) {
  const { id: raw } = await props.params;
  if (!/^\d+$/.test(raw)) notFound();
  const res = await chainDecision(BigInt(raw));

  if (res.status === "unavailable") {
    return (
      <>
        <PageHeader eyebrow="Karar kaydı" title={`Karar #${raw}`} />
        {res.reason.startsWith("Contracts") ? <NotDeployed what="karar kaydı" /> : <EmptyState title="Karar okunamadı">{res.reason}</EmptyState>}
      </>
    );
  }
  if (!res.value) notFound();

  const { view: v, provenance: p, store } = res.value;
  const d = p.decision;
  const issues = validateProvenance(p);
  const n = (i: number) => String(i + 1).padStart(2, "0");

  return (
    <>
      <PageHeader
        eyebrow="Karar kaydı · Monad Testnet"
        title={`Karar #${d.decisionId}`}
        lead={
          <span className="font-mono text-[13px]">
            oluşturulma {formatUtc(d.createdAt)} · proposer <a className="break-all underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.address(d.proposer)} target="_blank" rel="noreferrer">{d.proposer}</a>
          </span>
        }
        aside={<StatusMark tone={statusTone(d.status)}>{d.status}</StatusMark>}
      />

      <div className="mb-6">
        <LifecycleRail current={d.status} transitions={d.transitions} />
      </div>
      {!["RESOLVED", "CANCELLED"].includes(d.status) && (
        <div className="mb-6 max-w-[760px]">
          <LifecycleActions
            ctx={{
              decisionId: d.decisionId,
              status: d.status,
              deadline: d.deadline,
              finalsSubmitted: p.submissions.filter((s) => s.questionIndex === 0).length,
              participants: d.participants.length,
              guardianRequired: p.aggregation?.guardianRequired ?? false,
              guardianDeadline: p.aggregation?.guardianDeadline ?? null,
              allowedForks: d.config.allowedForks,
              executedAt: p.action?.execution?.executedAt ?? null,
              horizon: d.config.horizon,
            }}
          />
        </div>
      )}
      <div className="mb-6">
        <JevTrack stages={v.stages} />
      </div>
      <div className="mb-10">
        <KeyFigures v={v} />
      </div>

      <nav aria-label="Kayıt bölümleri" className="sticky top-0 z-10 -mx-4 mb-10 flex gap-x-5 overflow-x-auto border-b border-rule bg-bg/95 px-4 py-2.5 text-[13px] text-ink-2 [scrollbar-width:none] sm:-mx-6 sm:px-6">
        {SECTIONS.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} className="whitespace-nowrap hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Section id="state" index={n(0)} title="Durum" description="Ajanların değerlendirdiği anlık görüntü. Hash'i hiçbir ajan çalışmadan önce zincire işlendi.">
        <StatePanel v={v} />
      </Section>

      <Section
        id="questions"
        index={n(1)}
        title="Sorular"
        description={`${v.questions.items?.length ?? "—"} soru · izinli çatallar ${maskToForks(d.config.allowedForks).join(" · ")} · ufuk ${formatDuration(d.config.horizon)} · bant ±${d.config.bandBps} bps`}
      >
        <QuestionsPanel v={v} />
      </Section>

      <Section id="decisions" index={n(2)} title="Ajan kararları" description={`Her katılımcının zincire kaydedilen nihai kararı; ${formatMon(d.config.lockPerAgent)} MON teminatla desteklenir. Gerekçeler, metinleri zincir üstü hash ile doğrulandığında görünür.`}>
        <AgentModules agents={v.agents} />
      </Section>

      <Section id="aggregation" index={n(3)} title="Toplama ve eşik" description="DecisionEngine'den okunur; aynı tamsayı formülü zincir dışında da çalışır ve gönderimlerden yeniden üretilebilir.">
        <div className="max-w-[720px]">
          <AggregationPanel v={v} />
        </div>
      </Section>

      <Section id="action" index={n(4)} title="Sınırlı eylem">
        <div className="max-w-[720px]">
          <ActionPanel v={v} />
        </div>
      </Section>

      <Section id="transactions" index={n(5)} title="İşlemler" description="Her yaşam döngüsü geçişi, ona neden olan kontrat fonksiyonu (calldata'dan çözülür) ve bloğu.">
        {v.transitions.length ? <TransitionsTable v={v} /> : <EmptyState title="Okunabilir geçiş yok" />}
      </Section>

      <Section id="outcome" index={n(6)} title="Sonuç">
        <div className="max-w-[720px]">
          <OutcomePanel v={v} />
        </div>
      </Section>

      <Section
        id="settlement"
        index={n(7)}
        title="Hesap verebilirlik"
        description="Her ajanın ne tahmin ettiği, gerçekte ne olduğu, haklı çıkıp çıkmadığı ve teminatının nasıl değiştiği. Uzlaşma sabit protokol kurallarını izler; kimin ödülü hak ettiğine hiçbir model karar vermez."
      >
        <SettlementPanel v={v} />
      </Section>

      <Section
        id="integrity"
        index={n(8)}
        title="Bütünlük"
        description={store.available ? `Zincir dışı veri yükleri (${store.kind}) yeniden hesaplandı ve zincir üstü taahhütlerle karşılaştırıldı.` : `${store.reason}. Zincir üstü değerler veri yükleri olmadan gösteriliyor.`}
      >
        {v.integrity.length ? <IntegrityPanel v={v} /> : <EmptyState title="Kontrol yok" />}
      </Section>

      <Section
        id="provenance"
        index={n(9)}
        title="Köken izi"
        description="Her ajanın nihai kararı durumdan uzlaşmaya kadar izlenir. Her halka, her yüklemede komşularına karşı kontrol edilir."
        aside={<StatusMark tone={issues.length ? "fail" : "pass"}>{issues.length ? `${issues.length} tutarsızlık` : "tutarlı"}</StatusMark>}
      >
        {issues.length > 0 && (
          <ul className="mb-4 border border-fail px-4 py-3 text-[13px] text-fail">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {d.participants.map((agentId) => (
            <div key={agentId} className="min-w-0">
              <p className="mb-2 text-[13px] font-semibold">{v.agents.find((a) => a.agentId === agentId)?.name ?? `Ajan ${agentId}`}</p>
              <ProvenanceTrail steps={traceDecision(p, agentId)} />
            </div>
          ))}
        </div>
        <p className="mt-6 text-[12px] text-ink-3">
          Durum hash&apos;i <Hash value={d.stateHash} /> · soru hash&apos;i <Hash value={d.questionsHash} />
        </p>
      </Section>
    </>
  );
}
