"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { AgentModules } from "@/components/decision/agent-modules";
import { AggregationPanel, QuestionsPanel, StatePanel } from "@/components/decision/panels";
import { Button } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { formatBps, formatMon, formatPrice, formatUtc, shortHex } from "@/lib/format";
import { AGENTS } from "@/lib/jev/agents";
import { AGENT_TR, FORK_TR, agentName, resultLabel } from "@/lib/i18n";
import { ACTION_SPACE } from "@/lib/model/action";
import type { Settlement } from "@/lib/model/accountability";
import { FORKS } from "@/lib/types/protocol";
import type { DecisionView } from "@/lib/view/decision-view";
import { TxLifecycle } from "@/components/wallet/tx-lifecycle";
import type { TxState } from "@/components/wallet/use-wallet-tx";
import type { ChainTx, DemoMode, ExampleMove, VerifyResult } from "./use-demo";

const muted = (s: string) => <span className="text-ink-3">{s}</span>;

/** Re-render on an interval while `active` (for timers that show real elapsed time). */
function useNow(active: boolean, ms = 200) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

// 1 · 2 ─────────────────────────────────────────────────────────────────────

export function StateStep({ v, live, commitTx }: { v: DecisionView; live: boolean; commitTx: ChainTx | undefined }) {
  return (
    <div className="space-y-3">
      <StatePanel v={v} withInputs={false} />
      {v.state.inputs && (
        <details>
          <summary className="cursor-pointer text-[12.5px] text-ink">Kaynak ve durumlarıyla {v.state.inputs.length} girdinin tümü</summary>
          <div className="mt-2">
            <StatePanel v={{ ...v, state: { ...v.state } }} withInputs />
          </div>
        </details>
      )}
      {live && commitTx?.hash && (
        <p className="text-[12.5px] text-ink-2">
          Hiçbir ajan çalışmadan önce hash zincire işlendi:{" "}
          <a className="font-mono underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.tx(commitTx.hash)} target="_blank" rel="noreferrer">
            createDecision {shortHex(commitTx.hash, 4, 4)}
          </a>
        </p>
      )}
    </div>
  );
}

export function QuestionsStep({ v }: { v: DecisionView }) {
  return <QuestionsPanel v={v} />;
}

// 3 ─────────────────────────────────────────────────────────────────────────

/** Five lanes on one time axis: each bar is that agent's measured evaluation time. */
export function ParallelStep({ v, startedAt }: { v: DecisionView; startedAt: number | null }) {
  const processing = v.agents.some((a) => a.status === "processing");
  const now = useNow(processing);
  const elapsed = (a: DecisionView["agents"][number]) => (a.latencyMs !== null ? a.latencyMs : a.status === "processing" && startedAt ? now - startedAt : null);
  const max = Math.max(1, ...v.agents.map((a) => elapsed(a) ?? 0));
  return (
    <div className="border border-rule bg-surface">
      {v.agents.map((a) => {
        const ms = elapsed(a);
        const failed = a.status === "failed" || a.status === "missed";
        return (
          <div key={a.key} className="grid grid-cols-[minmax(120px,170px)_110px_1fr_56px] items-center gap-3 border-b border-rule px-4 py-2.5 text-[12.5px] last:border-b-0">
            <span className="truncate font-medium">{a.name}</span>
            <span>
              {a.failure ? (
                <StatusMark tone="fail">{a.failure.label}</StatusMark>
              ) : (
                <StatusMark tone={a.status === "ok" ? "pass" : a.status === "processing" ? "wait" : "neutral"} live={a.status === "processing"}>
                  {a.status === "ok" ? "karar verdi" : a.status === "processing" ? "değerlendiriyor" : a.status === "missed" ? "kaçırdı" : "bekliyor"}
                </StatusMark>
              )}
            </span>
            <div className="relative h-1.5 bg-surface-2">
              {ms !== null && <div className={`h-full ${failed ? "bg-fail" : a.status === "ok" ? "bg-ink" : "bg-accent"}`} style={{ width: `${(ms / max) * 100}%` }} />}
            </div>
            <span className="text-right font-mono tabular text-ink-2">{ms !== null ? `${(ms / 1000).toFixed(1)} s` : "—"}</span>
          </div>
        );
      })}
      <p className="px-4 py-2 text-[11.5px] text-ink-3">Beşi birlikte başlar; çubuklar aynı zaman eksenini paylaşır. Hiçbir ajan diğerinin çıktısını görmez.</p>
    </div>
  );
}

// 4 ─────────────────────────────────────────────────────────────────────────

export function PrimitivesStep({ v }: { v: DecisionView }) {
  return <AgentModules agents={v.agents} />;
}

// 5 ─────────────────────────────────────────────────────────────────────────

/** Every question-level decision, and how the ACTION row feeds the aggregation. */
export function BatchStep({ v, decision }: { v: DecisionView; decision: { agentDecisions: { agentId: number; questionIndex: number; choice: string; score: number; probability: number }[] } | null }) {
  const items = v.questions.items ?? [];
  const cell = (agentId: number, q: number) => decision?.agentDecisions.find((d) => d.agentId % AGENTS.length === agentId % AGENTS.length && d.questionIndex === q);
  return (
    <div className="space-y-2">
      <Table caption="Soru düzeyindeki kararlar">
        <thead>
          <tr>
            <Th>Soru</Th>
            {AGENTS.map((a) => (
              <Th key={a.key}>{AGENT_TR[a.key]?.short ?? a.name}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.questionId} className={q.index === 0 ? "bg-surface-2" : ""}>
              <Td className="whitespace-nowrap">
                <span className="font-mono text-ink-3">Q{q.index}</span> <span className="text-[11px] font-medium tracking-[0.06em]">{q.category}</span>
                {q.index === 0 && <span className="block text-[11px] text-accent">nihai karar → toplama</span>}
              </Td>
              {AGENTS.map((a) => {
                const d = cell(a.agentId, q.index);
                const assigned = q.answeredBy.includes(agentName(a.key, a.name));
                return (
                  <Td key={a.key} className="whitespace-nowrap">
                    {d ? (
                      <span className="font-mono text-[12px]">
                        {d.choice}
                        <span className="block text-ink-3">
                          {d.score} · {formatBps(d.probability, 0)}
                        </span>
                      </span>
                    ) : assigned ? (
                      muted("yanıt yok")
                    ) : (
                      <span className="text-ink-3">·</span>
                    )}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-[12px] text-ink-2">
        Her ajan kendi alan sorusunu ve eylem sorusunu tek bir toplu gönderimde yanıtlar. Her yanıt ayrı bir kayıttır (canlı modda zincirde);
        yalnızca Q0 yanıtları toplanır, alan yanıtları bunların arkasındaki kanıttır.
      </p>
    </div>
  );
}

// 6 ─────────────────────────────────────────────────────────────────────────

export function ForksStep({ v, allowed }: { v: DecisionView; allowed: string[] }) {
  const counts = Object.fromEntries(FORKS.map((f) => [f, v.agents.filter((a) => a.choice === f).length]));
  return (
    <Table caption="Sınırlı eylem uzayı">
      <thead>
        <tr>
          <Th>Çatal</Th>
          <Th>Kısa ad</Th>
          <Th>Etki</Th>
          <Th>İzinli</Th>
          <Th align="right">Nihai seçimler</Th>
        </tr>
      </thead>
      <tbody>
        {FORKS.map((f) => (
          <tr key={f}>
            <Td mono>{f}</Td>
            <Td mono className="text-ink-2">{ACTION_SPACE[f].alias}</Td>
            <Td className="min-w-[260px] text-ink-2">{FORK_TR[f].effect}</Td>
            <Td>{allowed.includes(f) ? <StatusMark tone="pass">evet</StatusMark> : <StatusMark tone="neutral">hayır</StatusMark>}</Td>
            <Td align="right" mono>{counts[f]}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// 7 ─────────────────────────────────────────────────────────────────────────

export function AggregationStep({ v }: { v: DecisionView }) {
  const g = v.aggregation;
  const fig = (label: string, value: React.ReactNode, note?: React.ReactNode) => (
    <div className="px-4 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 font-mono text-[20px] leading-7 tabular">{value}</p>
      {note && <p className="text-[12px] text-ink-2">{note}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 border border-rule bg-surface md:grid-cols-4 [&>*]:border-rule max-md:[&>*:nth-child(odd)]:border-r max-md:[&>*:nth-child(n+3)]:border-t md:[&>*:not(:last-child)]:border-r">
        {fig("Seçilen çatal", g ? g.leading : muted("—"), g ? `${g.submissions} nihai karar` : undefined)}
        {fig("Toplam skor", g?.aggregateScore ?? muted("—"), "destekçilerin ortalama skoru")}
        {fig("Toplam olasılık", g?.aggregateProbability != null ? formatBps(g.aggregateProbability, 1) : muted("—"), "destekçilerin ortalama olasılığı")}
        {fig(
          "Eşik",
          g?.supportShareBps != null ? formatBps(g.supportShareBps, 1) : muted("—"),
          g ? <StatusMark tone={g.passed ? "pass" : "fail"}>{g.passed ? `geçti · ≥ ${formatBps(v.threshold.thresholdBps, 0)}` : `sağlanmadı · gereken ${formatBps(v.threshold.thresholdBps, 0)}`}</StatusMark> : undefined,
        )}
      </div>
      <AggregationPanel v={v} />
    </div>
  );
}

// 8 ─────────────────────────────────────────────────────────────────────────

export function ActionStep({ v, mode, sim }: { v: DecisionView; mode: DemoMode; sim: { fork: string; start: { price: string; expo: number; publishTime: number } } | null }) {
  const a = v.action;
  if (!a) return <p className="text-[13px] text-ink-3">{v.aggregation?.guardianRequired ? "Ajanlar yükseltti: bir guardian sınırlı çatallar arasından seçim yapmalı." : "Toplama bekleniyor."}</p>;
  const passed = v.aggregation?.passed;
  return (
    <div className="border border-rule bg-surface px-4 py-3 text-[13px]">
      <p>
        <span className="font-mono text-[15px]">{a.fork}</span> <span className="text-ink-2">· {a.alias}</span>{" "}
        <StatusMark tone={passed ? "pass" : "neutral"}>{passed ? "eşik geçildi — seçilen eylem" : "eşik sağlanmadı — güvenli varsayılan"}</StatusMark>
      </p>
      <p className="mt-1 text-ink-2">{a.effect}</p>
      <p className="mt-1 text-[12px] text-ink-3">
        Onaylayan: {a.approvedBy}. {a.fork === "NO_ACTION" ? "Hiçbir şey taşınmaz; sonuç doğrulanabilsin diye başlangıç fiyatı yine kaydedilir." : "Yalnızca ExecutionVault'un bu önceden tanımlı dalı çalışabilir."}
      </p>
      {mode === "simulation" && sim && (
        <p className="mt-2 border-t border-rule pt-2 text-[12.5px] text-ink-2">
          Yerel kasa modeline uygulandı (fon yok, işlem yok). Başlangıç fiyatı {formatPrice(BigInt(sim.start.price), sim.start.expo)} USD, yayın zamanı {formatUtc(sim.start.publishTime)}.
        </p>
      )}
      {mode === "live" && v.execution.status === "executed" && (
        <p className="mt-2 border-t border-rule pt-2 font-mono text-[12.5px] text-ink-2">
          taşınan {v.execution.amountMoved ? formatMon(BigInt(v.execution.amountMoved)) : "0"} MON · başlangıç fiyatı {v.execution.startPrice} USD
        </p>
      )}
    </div>
  );
}

// 9 ─────────────────────────────────────────────────────────────────────────

export function MonadStep({
  mode,
  txs,
  awaiting,
  onExecute,
  walletTx,
}: {
  mode: DemoMode;
  txs: ChainTx[];
  awaiting: boolean;
  onExecute: (via: "wallet" | "keeper") => void;
  walletTx?: TxState;
}) {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  if (mode === "simulation") {
    return (
      <p className="border border-dashed border-rule px-4 py-3 text-[13px] text-ink-2">
        İşlem yok. Simülasyon modu Monad&apos;a hiçbir şey göndermez; aynı turun zincire işlenmesini, yürütülmesini ve uzlaşmasını görmek için canlı
        testnet moduna geçin.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ol className="border border-rule bg-surface">
        {txs.length === 0 && <li className="px-4 py-2.5 text-[12.5px] text-ink-3">Henüz işlem yok.</li>}
        {txs.map((t) => (
          <li key={t.label} className="dm-arrive grid grid-cols-[1fr_auto] gap-3 border-b border-rule px-4 py-2 text-[12.5px] last:border-b-0">
            <div className="min-w-0">
              <p className="font-mono">{t.label}</p>
              {t.detail && <p className={`text-[11.5px] ${t.status === "failed" ? "text-fail" : "text-ink-3"}`}>{t.detail}</p>}
            </div>
            <div className="flex items-center gap-3">
              {t.hash && (
                <a className="font-mono text-[11.5px] underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.tx(t.hash)} target="_blank" rel="noreferrer">
                  {shortHex(t.hash, 4, 4)}
                </a>
              )}
              <StatusMark tone={t.status === "confirmed" ? "pass" : t.status === "failed" ? "fail" : "wait"} live={t.status === "pending"}>
                {t.status === "confirmed" ? "onaylandı" : t.status === "failed" ? "başarısız" : t.status === "pending" ? "bekliyor" : t.status}
              </StatusMark>
            </div>
          </li>
        ))}
      </ol>
      {walletTx && <TxLifecycle state={walletTx} />}
      {awaiting && (
        <div className="flex flex-wrap items-center gap-3 border border-accent px-4 py-3">
          <p className="min-w-0 flex-1 basis-64 text-[13px]">Eylem zincirde onaylandı. Cüzdanınızdan yürütün — herkes yürütebilir; neyin çalışacağına kontrat karar verir.</p>
          {!isConnected ? (
            <span className="text-[12.5px] text-ink-2">Onaylamak için cüzdan bağlayın (sağ üst) ya da</span>
          ) : chainId !== 10143 ? (
            <Button variant="secondary" onClick={() => switchChain({ chainId: 10143 })}>
              Monad Testnet&apos;e geç
            </Button>
          ) : (
            <Button onClick={() => onExecute("wallet")}>Cüzdanda onayla</Button>
          )}
          <Button variant="secondary" onClick={() => onExecute("keeper")}>
            Keeper ile yürüt
          </Button>
        </div>
      )}
    </div>
  );
}

// 10 ────────────────────────────────────────────────────────────────────────

export function Countdown({ label, until, total }: { label: string; until: number; total: number }) {
  const now = useNow(true, 250) / 1000;
  const left = Math.max(0, until - now);
  const pct = total > 0 ? Math.min(100, ((total - left) / total) * 100) : 100;
  return (
    <div className="border border-rule bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span>Bekleniyor: {label}</span>
        <span className="font-mono tabular">{Math.ceil(left)} s</span>
      </div>
      <div className="mt-2 h-1 bg-surface-2">
        <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function VerifyStep({ r, mode }: { r: VerifyResult | null; mode: DemoMode }) {
  if (!r) return null;
  const row = (label: string, expected: React.ReactNode, observed: React.ReactNode) => (
    <div className="grid grid-cols-[120px_1fr_1fr] gap-3 border-b border-rule px-4 py-2 last:border-b-0">
      <span className="label self-center">{label}</span>
      <span className="font-mono text-[13px]">{expected}</span>
      <span className="font-mono text-[13px]">{observed}</span>
    </div>
  );
  const example = r.source === "example";
  return (
    <div className="border border-rule bg-surface">
      {example && (
        <p className="border-b border-rule bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--surface-2)_8px_9px)] px-4 py-2 text-[12px]">
          <span className="mr-2 font-mono font-medium tracking-[0.06em]">ÖRNEK SENARYO</span>
          <span className="text-ink-2">Fiyatlar gerçek değil; ajanların bu turdaki gerçek kararları varsayımsal bir fiyat hareketine göre değerlendiriliyor.</span>
        </p>
      )}
      <div className="grid grid-cols-[120px_1fr_1fr] gap-3 border-b border-rule bg-surface-2 px-4 py-2">
        <span />
        <span className="label">Beklenen</span>
        <span className="label">Gözlenen</span>
      </div>
      {row("Eylem", r.expected, <span className={r.success ? "text-pass" : "text-fail"}>{r.observed}</span>)}
      {row("Fiyat", `${r.startPrice} USD${r.startTime ? ` · ${formatUtc(r.startTime).slice(11)}` : ""}`, `${r.endPrice} USD${r.endTime ? ` · ${formatUtc(r.endTime).slice(11)}` : ""}`)}
      {row("Hareket", `bant ±${r.bandBps} bps`, `${r.moveBps} bps`)}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <StatusMark tone={r.success ? "pass" : "fail"}>{r.success ? "başarılı — beklenen gözlenene eşit" : "isabetsiz — beklenen gözlenenden farklı"}</StatusMark>
        <span className="text-[11.5px] text-ink-3">
          {example
            ? "Örnek fiyat hareketi; gerçek turda bu değerler imzalı Pyth fiyatından gelir."
            : mode === "live"
              ? "OutcomeRegistry tarafından pencere içindeki imzalı bir Pyth fiyatından kaydedildi."
              : "Yayımlanan Pyth fiyatından gözlendi; simülasyonda zincirde doğrulanmaz."}
        </span>
      </div>
    </div>
  );
}

// 11 ────────────────────────────────────────────────────────────────────────

export function SettlementStep({ mode, v, sim, example = false }: { mode: DemoMode; v: DecisionView; sim: Settlement | null; example?: boolean }) {
  const rows =
    mode === "simulation"
      ? (sim?.lines ?? []).map((l) => ({ agentId: l.agentId, result: l.result, bond: l.bond, penalty: l.penalty, reward: l.reward, net: l.net }))
      : v.settlement.lines.map((l) => ({ agentId: l.agentId, result: l.result, bond: BigInt(l.bond), penalty: BigInt(l.penalty), reward: BigInt(l.reward), net: BigInt(l.net) }));
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <Table caption="Uzlaşma">
        <thead>
          <tr>
            <Th>Ajan</Th>
            <Th>Tahmin</Th>
            <Th>Sonuç</Th>
            <Th align="right">Teminat</Th>
            <Th align="right">Ödül</Th>
            <Th align="right">Ceza</Th>
            <Th align="right">Net</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const a = v.agents.find((x) => x.agentId === l.agentId);
            return (
              <tr key={l.agentId}>
                <Td className="whitespace-nowrap font-medium">{a?.name ?? `Ajan ${l.agentId}`}</Td>
                <Td mono className="whitespace-nowrap">{a?.choice ? `${a.choice} · ${formatBps(a.probability ?? 0, 0)}` : muted("yok")}</Td>
                <Td>
                  <StatusMark tone={l.result === "CORRECT" ? "pass" : l.result === "NEUTRAL" || !l.result ? "neutral" : "fail"}>{l.result ? resultLabel(l.result) : "—"}</StatusMark>
                </Td>
                <Td align="right" mono>{formatMon(l.bond)}</Td>
                <Td align="right" mono>{formatMon(l.reward)}</Td>
                <Td align="right" mono>{formatMon(l.penalty)}</Td>
                <Td align="right" mono className={l.net > 0n ? "text-pass" : l.net < 0n ? "text-fail" : ""}>
                  {l.net < 0n ? `−${formatMon(-l.net)}` : `+${formatMon(l.net)}`}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-[12px] text-ink-3">
        {example
          ? "Örnek senaryo: OutcomeRegistry'nin gerçek formülü, ajanların bu turdaki gerçek kararlarına ve varsayımsal fiyat hareketine uygulandı. Hiçbir teminat kilitlenmedi."
          : mode === "simulation"
          ? "OutcomeRegistry formülüyle itibari teminatlar (MON) üzerinden hesaplandı. Hiçbir teminat kilitlenmedi ve hiçbir şey transfer edilmedi."
          : "OutcomeRegistry tarafından resolve işleminde uygulandı; teminatlar ve ödül havuzu zincirde değişti."}
      </p>
    </div>
  );
}

/** Shown when no real price is available: the decision is real, verification is explained with a labelled example. */
export function ExampleChooser({ reason, onPick, action }: { reason: string; onPick: (m: ExampleMove) => void; action: string | null }) {
  return (
    <div className="border border-rule bg-surface px-4 py-3 text-[13px]">
      <p className="font-medium">Gerçek fiyat verisi şu an alınamıyor.</p>
      <p className="mt-1 text-ink-2">
        Ajanların kararları ve toplama gerçek{action ? ` (seçilen eylem: ${action})` : ""}. Doğrulama için ufuk sonundaki gerçek ETH/USD fiyatı
        gerekiyor; bu dağıtımda Pyth anahtarı yapılandırılmadığı için okunamadı.
      </p>
      <p className="mt-1 font-mono text-[11.5px] text-ink-3">{reason}</p>
      <p className="mt-3 text-ink-2">Doğrulama ve ödül/ceza mekanizmasını bir örnek fiyat hareketiyle görün:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onPick("down")}>
          Fiyat %0,5 düşerse
        </Button>
        <Button variant="secondary" onClick={() => onPick("flat")}>
          Fiyat sabit kalırsa
        </Button>
        <Button variant="secondary" onClick={() => onPick("up")}>
          Fiyat %0,5 yükselirse
        </Button>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Sonuçlar “örnek senaryo” olarak işaretlenir ve kaydedilmez.</p>
    </div>
  );
}
