"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusMark, type Tone } from "@/components/ui/status";
import { formatBps } from "@/lib/format";
import type { DecisionView } from "@/lib/view/decision-view";
import {
  ActionStep,
  AggregationStep,
  BatchStep,
  Countdown,
  ForksStep,
  MonadStep,
  ParallelStep,
  PrimitivesStep,
  QuestionsStep,
  SettlementStep,
  StateStep,
  VerifyStep,
} from "./step-content";
import { OperatorSessionBar, useOperatorSession } from "@/components/wallet/operator-session";
import { STEPS, useDemo, type DemoMode, type StepKey, type StepStatus } from "./use-demo";
import { ROUND_TIMING } from "@/lib/decmarkt/params";

interface ModeAvailability {
  ok: boolean;
  reason: string;
}

const STEP_COPY: Record<StepKey, { title: string; what: string }> = {
  STATE: { title: "Durum", what: "Kararın konusu olan gerçekler; şimdi kaynaklarından toplanır ve hash'lenir." },
  QUESTIONS: { title: "Sorular", what: "Jev durumu açık sorulara dönüştürür. Her sorunun kendi kimliği ve değerlendirdiği girdiler vardır." },
  PARALLEL: { title: "Paralel kararlar", what: "Beş analist aynı anda, aynı durum üzerinde başlar; hiçbiri diğerinin çıktısını görmez." },
  PRIMITIVES: { title: "Seçim · Skor · Olasılık · Gerekçe", what: "Her analistin nihai kararı. Skor rubrik puanlarından hesaplanır; gerekçe yalnızca bilgi amaçlıdır." },
  BATCH: { title: "Toplu gönderim ve soru sonuçları", what: "Soru düzeyindeki her yanıt saklanır; toplanan, eylem sorusunun yanıtıdır." },
  FORKS: { title: "Sınırlı çatallar", what: "Hiçbir ajan çalışmadan önce sabitlenen eylem uzayının tamamı. Bunun dışındaki hiçbir şey yürütülemez." },
  AGGREGATION: { title: "Toplama", what: "DecMarkt'ın deterministik kuralları: her çatal için olasılık × geçmiş başarı, ardından eşik. Hiçbir modele sorulmaz." },
  ACTION: { title: "Eylem", what: "Kuralların onayladığı tek önceden tanımlı eylem ya da güvenli varsayılan olarak NO_ACTION." },
  MONAD: { title: "Monad", what: "Taahhüt, teminatlı gönderimler, toplama ve yürütme; Monad Testnet üzerinde işlemler olarak." },
  VERIFY: { title: "Doğrulama", what: "Ufuk dolduktan sonra gerçek fiyat hareketi hangi eylemin doğru olduğuna karar verir: beklenen ve gözlenen." },
  SETTLEMENT: { title: "Uzlaşma", what: "Teminatlar sabit kurallarla iade edilir, ödüllendirilir ya da cezalandırılır. Ajanların söz hakkı yoktur." },
};

const tone: Record<StepStatus, Tone> = { pending: "neutral", active: "wait", done: "pass", failed: "fail", skipped: "neutral", stopped: "neutral" };
const statusText: Record<StepStatus, string> = { pending: "bekliyor", active: "sürüyor", done: "tamam", failed: "başarısız", skipped: "atlandı", stopped: "durdu" };

export function Demo({ modes, idle, allowedForks }: { modes: Record<DemoMode, ModeAvailability>; idle: DecisionView; allowedForks: string[] }) {
  const d = useDemo();
  const session = useOperatorSession();
  const needsOperator = d.mode === "live" && !session.operator;
  const started = d.startedAt !== null;
  const v = started ? d.view : idle;
  const current = STEPS.find((k) => d.steps[k].status === "active" || d.steps[k].status === "failed");
  const failed = STEPS.find((k) => d.steps[k].status === "failed");
  const liveRound = started && d.mode === "live";

  const content: Record<StepKey, ReactNode> = {
    STATE: <StateStep v={v} live={liveRound} commitTx={d.txs.find((t) => t.label === "createDecision")} />,
    QUESTIONS: <QuestionsStep v={v} />,
    PARALLEL: <ParallelStep v={v} startedAt={d.parallelStartedAt} />,
    PRIMITIVES: <PrimitivesStep v={v} />,
    BATCH: <BatchStep v={v} decision={d.decision ?? null} />,
    FORKS: <ForksStep v={v} allowed={allowedForks} />,
    AGGREGATION: <AggregationStep v={v} />,
    ACTION: <ActionStep v={v} mode={d.mode} sim={d.simExecution} />,
    MONAD: <MonadStep mode={d.mode} txs={d.txs} awaiting={d.awaitingExecution} onExecute={d.executeLive} walletTx={d.walletTx} />,
    VERIFY: (
      <div className="space-y-3">
        {d.countdown && <Countdown {...d.countdown} />}
        <VerifyStep r={d.verify} mode={d.mode} />
      </div>
    ),
    SETTLEMENT: <SettlementStep mode={d.mode} v={v} sim={d.simSettlement} />,
  };

  // Before a round starts, the current snapshot and the action space are already real and shown.
  const visible = (k: StepKey) => {
    const s = d.steps[k].status;
    if (!started) return k === "STATE" || k === "QUESTIONS" || k === "FORKS";
    if (k === "MONAD") return s !== "pending" || d.mode === "simulation";
    if (k === "PARALLEL") return s !== "pending";
    return s === "done" || s === "active" || s === "failed" || (k === "FORKS" && s !== "stopped");
  };

  return (
    <div className="space-y-6">
      {/* Mode + control */}
      <div className="border border-rule bg-surface">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {(["simulation", "live"] as const).map((m, i) => {
            const selected = d.mode === m;
            const ok = modes[m].ok;
            return (
              <button
                key={m}
                type="button"
                disabled={!ok || d.running}
                onClick={() => d.setMode(m)}
                aria-pressed={selected}
                className={`relative px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed ${i === 0 ? "max-md:border-b md:border-r" : ""} border-rule ${
                  selected ? "bg-surface-2" : "hover:bg-surface-2/60"
                }`}
              >
                <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 ${selected ? (m === "live" ? "bg-accent" : "bg-ink") : "bg-transparent"}`} />
                <span className="flex items-center justify-between gap-3">
                  <span className={`text-[13px] font-semibold ${ok ? "" : "text-ink-3"}`}>{m === "simulation" ? "Simülasyon modu" : "Canlı testnet modu"}</span>
                  <StatusMark tone={ok ? (selected ? "accent" : "neutral") : "neutral"}>{ok ? (selected ? "seçili" : "kullanılabilir") : "kullanılamaz"}</StatusMark>
                </span>
                <span className="mt-1 block text-[12.5px] text-ink-2">{modes[m].reason}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule px-4 py-3">
          {d.mode === "live" && <OperatorSessionBar session={session} />}
          <Button onClick={d.start} disabled={!modes[d.mode].ok || d.running || needsOperator}>
            {d.running ? "Çalışıyor…" : started ? "Tekrar çalıştır" : d.mode === "live" ? "Canlı turu başlat" : "Simülasyonu başlat"}
          </Button>
          {failed && !d.running && (
            <Button variant="secondary" onClick={d.retry}>
              Yeniden dene: {STEP_COPY[failed].title}
            </Button>
          )}
          <span className="text-[12.5px] text-ink-2">Demo zaman ölçeği: {ROUND_TIMING.submissionWindowSec} sn gönderim penceresi, {ROUND_TIMING.horizonSec} sn ufuk. Aynı kurallar, daha kısa saat.</span>
        </div>
      </div>

      {/* Mode banner: never ambiguous about what is on-chain */}
      {started &&
        (d.mode === "simulation" ? (
          <div className="border border-rule bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--surface-2)_8px_9px)] px-4 py-2.5 text-[12.5px]">
            <span className="mr-2 font-mono font-medium tracking-[0.06em]">SİMÜLASYON</span>
            <span className="text-ink-2">Gerçek durum ve gerçek ajanlar. İşlem yok: yürütme, doğrulama ve uzlaşma yerel olarak hesaplanır; buradaki hiçbir şey zincirde değildir.</span>
          </div>
        ) : (
          <div className="border border-accent px-4 py-2.5 text-[12.5px]">
            <span className="mr-2 font-mono font-medium tracking-[0.06em] text-accent">CANLI · MONAD TESTNET</span>
            <span className="text-ink-2">Aşağıdaki her aşama 10143 zincirinde bir işlemdir{d.decision?.mode === "live" ? ` · karar #${d.decision.decisionId}` : ""}.</span>
          </div>
        ))}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* The narrative */}
        <ol className="min-w-0">
          {STEPS.map((k, i) => {
            const s = d.steps[k];
            const show = visible(k);
            const isLast = i === STEPS.length - 1;
            return (
              <li key={k} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-4">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border font-mono text-[11px] ${
                      s.status === "done" ? "border-ink bg-ink text-bg" : s.status === "active" ? "border-accent text-accent" : s.status === "failed" ? "border-fail text-fail" : "border-rule text-ink-3"
                    } ${s.status === "active" ? "dm-pending" : ""}`}
                  >
                    {i + 1}
                  </span>
                  {!isLast && <span className={`w-px flex-1 ${s.status === "done" ? "bg-ink" : "bg-rule"}`} />}
                </div>
                <section className={`min-w-0 pb-8 ${show ? "" : "pb-5"}`} aria-labelledby={`step-${k}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 id={`step-${k}`} className={`text-[15px] font-medium ${s.status === "pending" || s.status === "stopped" ? "text-ink-2" : ""}`}>
                      {STEP_COPY[k].title}
                    </h2>
                    {started && (
                      <StatusMark tone={tone[s.status]} live={s.status === "active"}>
                        {statusText[s.status]}
                      </StatusMark>
                    )}
                  </div>
                  <p className="mt-0.5 max-w-[72ch] text-[12.5px] text-ink-2">
                    {STEP_COPY[k].what}
                    {s.note && <span className="text-ink-3"> — {s.note}</span>}
                  </p>
                  {s.status === "failed" && s.error && (
                    <div role="alert" className="mt-3 border border-fail px-4 py-3 text-[13px]">
                      <p className="font-medium text-fail">Durduğu adım: {STEP_COPY[k].title}</p>
                      <p className="mt-1 break-words font-mono text-[12px] text-ink">{s.error}</p>
                      <div className="mt-3">
                        <Button variant="secondary" onClick={d.retry} disabled={d.running}>
                          Yeniden dene
                        </Button>
                      </div>
                    </div>
                  )}
                  {show && <div className="dm-arrive mt-3">{content[k]}</div>}
                  {!started && show && k !== "FORKS" && <p className="mt-2 text-[11.5px] text-ink-3">Güncel anlık görüntü — tur başladığında zincire işlenir.</p>}
                </section>
              </li>
            );
          })}
        </ol>

        {/* Round summary */}
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="border border-rule bg-surface">
            <p className="border-b border-rule px-4 py-2.5 text-[13px] font-semibold">Tur</p>
            <dl className="divide-y divide-rule text-[12.5px]">
              <Row k="Mod" v={d.mode === "live" ? "canlı testnet" : "simülasyon"} />
              <Row k="Karar" v={d.decision?.mode === "live" ? `#${d.decision.decisionId}` : started ? "zincirde değil" : "—"} />
              <Row k="Adım" v={current ? `${STEPS.indexOf(current) + 1} · ${STEP_COPY[current].title}` : started ? "tamamlandı" : "başlamadı"} />
              <Row k="Ajanlar" v={started ? `${v.agents.filter((a) => a.status === "ok").length}/5 karar verdi` : "—"} />
              <Row k="Seçilen" v={v.aggregation?.leading ?? "—"} />
              <Row k="Eşik" v={v.aggregation ? `${v.aggregation.supportShareBps != null ? formatBps(v.aggregation.supportShareBps, 1) : "—"} · ${v.aggregation.passed ? "geçti" : "sağlanmadı"}` : "—"} />
              <Row k="Eylem" v={v.action?.fork ?? "—"} />
              <Row k="Sonuç" v={d.verify ? `${d.verify.observed} · ${d.verify.success ? "başarılı" : "isabetsiz"}` : "—"} />
            </dl>
          </div>
          {d.decision?.mode === "live" && (
            <Link href={`/decisions/${d.decision.decisionId}`} className="mt-3 block text-[13px] text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink">
              Karar #{d.decision.decisionId} için tam denetim kaydı →
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 px-4 py-2">
      <dt className="label self-center">{k}</dt>
      <dd className="truncate font-mono">{v}</dd>
    </div>
  );
}
