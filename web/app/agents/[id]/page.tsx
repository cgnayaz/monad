import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { EmptyState, StatusMark, type Tone } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { agentLedger } from "@/lib/data/accountability";
import { listAgents } from "@/lib/data/agents";
import { formatBps, formatMon, formatUtc } from "@/lib/format";
import { AGENT_TR, agentName, resultLabel } from "@/lib/i18n";
import { AGENTS } from "@/lib/jev/agents";
import { DOMAIN_LABEL } from "@/lib/view/decision-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/agents/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const a = AGENTS.find((x) => String(x.agentId) === id);
  return { title: a ? agentName(a.key, a.name) : "Ajan" };
}

const tone = (r: string | null): Tone => (r === "CORRECT" ? "pass" : r === "WRONG" || r === "MISSED" ? "fail" : "neutral");
const signed = (w: bigint) => (w < 0n ? `−${formatMon(-w)}` : `+${formatMon(w)}`);

/** One agent's record: every prediction it made on-chain, what happened, and what it cost or earned. */
export default async function AgentPage(props: PageProps<"/agents/[id]">) {
  const { id } = await props.params;
  const spec = AGENTS.find((a) => String(a.agentId) === id);
  if (!spec) notFound();
  const [ledger, views] = await Promise.all([agentLedger(spec.agentId), listAgents()]);
  const onChain = views.find((x) => x.spec.agentId === spec.agentId)!.onChain;

  return (
    <>
      <PageHeader
        eyebrow={`Ajan ${spec.agentId} · ${DOMAIN_LABEL[spec.key]}`}
        title={agentName(spec.key, spec.name)}
        lead={AGENT_TR[spec.key]?.mandate ?? spec.mandate}
        aside={
          <Link href="/agents" className="text-[13px] text-ink-2 hover:text-ink">
            Tüm ajanlar →
          </Link>
        }
      />

      <div className="mb-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Zincir üstü kimlik">
          <KeyValue
            rows={[
              { k: "Operatör", v: <Avail value={onChain}>{(a) => <Hash value={a.operator} href={explorer.address(a.operator)} full />}</Avail> },
              { k: "Durum", v: <Avail value={onChain}>{(a) => <StatusMark tone={a.active ? "pass" : "neutral"}>{a.active ? "aktif" : "pasif"}</StatusMark>}</Avail> },
              { k: "Serbest teminat", v: <Avail value={onChain}>{(a) => <span className="font-mono">{formatMon(a.bond)} MON</span>}</Avail> },
              { k: "Kilitli", v: <Avail value={onChain}>{(a) => <span className="font-mono">{formatMon(a.locked)} MON</span>}</Avail> },
            ]}
          />
        </Panel>
        <Panel title="Geçmiş başarı">
          <KeyValue
            rows={[
              {
                k: "İsabet",
                v: (
                  <Avail value={onChain}>
                    {(a) => (
                      <span className="font-mono">
                        {a.correct} / {a.submitted} doğru
                        {a.submitted > 0 && ` (${formatBps(Math.round((a.correct * 10_000) / a.submitted), 1)})`}
                      </span>
                    )}
                  </Avail>
                ),
              },
              {
                k: "Oy ağırlığı",
                v: <Avail value={onChain}>{(a) => <span className="font-mono">{formatBps(Math.floor(((a.correct + 1) * 10_000) / (a.submitted + 2)), 1)} × olasılığı</span>}</Avail>,
              },
              { k: "Kaçırılan", v: <Avail value={onChain}>{(a) => <span className="font-mono">{a.missed}</span>}</Avail> },
              {
                k: "Uzlaşmalardan net",
                v: <Avail value={ledger}>{(l) => <span className={`font-mono ${l.totals.net > 0n ? "text-pass" : l.totals.net < 0n ? "text-fail" : ""}`}>{signed(l.totals.net)} MON</span>}</Avail>,
              },
            ]}
          />
        </Panel>
      </div>

      <Section
        title="Tahminler ve sonuçları"
        description="Bu ajanın katıldığı tüm kararlar, en yeniden eskiye. Tahmin, zincire gönderdiği nihai karardır; sonuç ve uzlaşma OutcomeRegistry'nin kaydettiğidir."
      >
        {ledger.status !== "ok" ? (
          <EmptyState title="Kayıt okunamadı">{ledger.reason}</EmptyState>
        ) : ledger.value.rows.length === 0 ? (
          <EmptyState title="Henüz karar yok">Bu ajan dağıtılmış kayıt defterinde henüz bir karara katılmadı.</EmptyState>
        ) : (
          <>
            <Table caption="Ajan defteri">
              <thead>
                <tr>
                  <Th>Karar</Th>
                  <Th>Tahmin</Th>
                  <Th>Yürütülen</Th>
                  <Th>Gerçekleşen</Th>
                  <Th>Sonuç</Th>
                  <Th align="right">Teminat</Th>
                  <Th align="right">Ceza</Th>
                  <Th align="right">Ödül</Th>
                  <Th align="right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.value.rows.map((r) => (
                  <tr key={r.decisionId}>
                    <Td mono className="whitespace-nowrap">
                      <Link href={`/decisions/${r.decisionId}#settlement`} className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                        #{r.decisionId}
                      </Link>
                      <span className="block text-[11px] text-ink-3">{r.resolvedAt ? formatUtc(r.resolvedAt).slice(0, 16) : r.status}</span>
                    </Td>
                    <Td mono className="whitespace-nowrap">
                      {r.choice ?? <span className="text-ink-3">yok</span>}
                      {r.choice && <span className="block text-[11px] text-ink-3">skor {r.score} · p {formatBps(r.probability ?? 0, 0)}</span>}
                    </Td>
                    <Td mono>{r.executed ?? <span className="text-ink-3">—</span>}</Td>
                    <Td mono>{r.observed ?? <span className="text-ink-3">{r.status === "RESOLVED" ? "geçersiz" : "bekliyor"}</span>}</Td>
                    <Td>{r.result ? <StatusMark tone={tone(r.result)}>{resultLabel(r.result)}</StatusMark> : <span className="text-[12px] text-ink-3">{r.status.toLowerCase()}</span>}</Td>
                    <Td align="right" mono>{formatMon(r.lock)}</Td>
                    <Td align="right" mono>{r.result ? formatMon(r.penalty) : "—"}</Td>
                    <Td align="right" mono>{r.result ? formatMon(r.reward) : "—"}</Td>
                    <Td align="right" mono className={r.net > 0n ? "text-pass" : r.net < 0n ? "text-fail" : ""}>
                      {r.result ? signed(r.net) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-[12.5px] text-ink-2">
              {ledger.value.totals.settled} uzlaşıldı: {ledger.value.totals.correct} doğru, {ledger.value.totals.wrong} yanlış, {ledger.value.totals.missed} kaçırıldı,{" "}
              {ledger.value.totals.neutral} nötr · ödüller {formatMon(ledger.value.totals.reward)} · cezalar {formatMon(ledger.value.totals.penalty)} MON
              {ledger.value.truncated && ` · son ${ledger.value.scanned} karar gösteriliyor`}
            </p>
          </>
        )}
      </Section>
    </>
  );
}
