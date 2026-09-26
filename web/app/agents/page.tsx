import type { Metadata } from "next";
import Link from "next/link";
import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { PageHeader, Section } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { listAgents } from "@/lib/data/agents";
import { DEFAULT_PARAMS } from "@/lib/decmarkt/params";
import { formatBps, formatMon } from "@/lib/format";
import { QUESTION_TEMPLATES, DEFAULT_ASSIGNMENT } from "@/lib/jev/questions";
import { AGENT_TR, agentName, questionText, rubricText } from "@/lib/i18n";
import { DOMAIN_LABEL } from "@/lib/view/decision-view";

export const metadata: Metadata = { title: "Ajanlar" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await listAgents();
  const p = DEFAULT_PARAMS;
  return (
    <>
      <PageHeader
        eyebrow="Hesap verebilirlik"
        title="Ajanlar"
        lead="Ayrı sorumlulukları olan beş analitik modül. Her biri kendi operatör adresi ve teminatı olan bir zincir üstü kimliktir; isabeti her doğrulanmış sonuçtan sonra kontratlar tarafından kaydedilir ve oy ağırlığına dönüşür."
      />

      <Section title="Modüller">
        <ol className="border border-rule bg-surface">
          {agents.map(({ spec, onChain }) => {
            const primary = QUESTION_TEMPLATES.find((q) => q.category === spec.primaryQuestion)!;
            const totalWeight = primary.rubric.reduce((t, f) => t + f.weight, 0);
            return (
              <li key={spec.key} className="grid grid-cols-1 gap-x-8 gap-y-4 border-b border-rule px-5 py-5 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)_260px]">
                <div>
                  <p className="font-mono text-[11px] text-ink-3">ajan {spec.agentId}</p>
                  <Link href={`/agents/${spec.agentId}`} className="text-[15px] font-medium underline decoration-rule underline-offset-2 hover:decoration-ink">
                    {agentName(spec.key, spec.name)}
                  </Link>
                  <p className="text-[12.5px] text-ink-2">{DOMAIN_LABEL[spec.key]}</p>
                </div>
                <div className="min-w-0 space-y-3">
                  <p className="text-[13.5px] leading-[21px]">{AGENT_TR[spec.key]?.mandate ?? spec.mandate}</p>
                  <div>
                    <p className="label">Yanıtladığı sorular</p>
                    <p className="mt-1 text-[13px] text-ink-2">
                      <span className="font-mono text-ink">Q{primary.index}</span> {questionText(primary.category, primary.text)} <span className="text-ink-3">· ve Q0, eylem sorusu</span>
                    </p>
                  </div>
                  <div>
                    <p className="label">Rubrik (skor = ağırlıklı 0–4 puanlar → 0–10000)</p>
                    <ul className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 text-[12.5px] text-ink-2 sm:grid-cols-2">
                      {primary.rubric.map((f) => (
                        <li key={f.factor} className="flex justify-between gap-3">
                          <span className="font-mono text-ink" title={rubricText(f.factor, f.description)}>{f.factor}</span>
                          <span className="font-mono text-ink-3">
                            {f.weight}/{totalWeight}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-2 text-[12.5px] lg:grid-cols-1">
                  <div>
                    <dt className="label">Operatör</dt>
                    <dd className="mt-0.5">
                      <Avail value={onChain}>{(a) => <Hash value={a.operator} href={explorer.address(a.operator)} />}</Avail>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Durum</dt>
                    <dd className="mt-0.5">
                      <Avail value={onChain}>{(a) => <StatusMark tone={a.active ? "pass" : "neutral"}>{a.active ? "aktif" : "pasif"}</StatusMark>}</Avail>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Teminat · kilitli (MON)</dt>
                    <dd className="mt-0.5 font-mono">
                      <Avail value={onChain}>{(a) => `${formatMon(a.bond, 3)} · ${formatMon(a.locked, 3)}`}</Avail>
                    </dd>
                  </div>
                  <div>
                    <dt className="label">Doğru / sonuçlanan · kaçırılan</dt>
                    <dd className="mt-0.5 font-mono">
                      <Avail value={onChain}>{(a) => `${a.correct} / ${a.submitted} · ${a.missed}`}</Avail>
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
        {agents.some((a) => a.onChain.status !== "ok") && (
          <p className="mt-3 text-[12.5px] text-ink-3">Ajanlar dağıtılmış bir DecisionRegistry&apos;ye kaydedilene kadar zincir üstü alanlar boş kalır.</p>
        )}
        <p className="mt-3 text-[12.5px] text-ink-3">
          Atama: {Object.entries(DEFAULT_ASSIGNMENT).map(([k, q]) => `${k} → Q${q.join(", Q")}`).join(" · ")}
        </p>
      </Section>

      <Section
        title="Uzlaşma"
        description={`Her kararda her katılımcı ${formatMon(p.lockPerAgent, 2)} MON kilitler. OutcomeRegistry her teminatı doğrulanmış sonuca göre uzlaştırır; ajanların buna etkisi yoktur.`}
      >
        <Table caption="Uzlaşma kuralları">
          <thead>
            <tr>
              <Th>Sonuç</Th>
              <Th>Koşul</Th>
              <Th>Ceza</Th>
              <Th>Ödül</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td mono>CORRECT</Td>
              <Td>Nihai seçim, gözlenen hareketin doğru kıldığı çatala eşit</Td>
              <Td>yok</Td>
              <Td>Olasılığa göre cezalardan pay + tur ödülü</Td>
            </tr>
            <tr>
              <Td mono>WRONG</Td>
              <Td>NO_ACTION, DERISK veya DEPLOY ve doğru çatal değil</Td>
              <Td className="font-mono">teminat × {formatBps(p.slashBps, 0)} × olasılık</Td>
              <Td>yok</Td>
            </tr>
            <tr>
              <Td mono>NEUTRAL</Td>
              <Td>ESCALATE</Td>
              <Td>yok</Td>
              <Td>yok</Td>
            </tr>
            <tr>
              <Td mono>MISSED</Td>
              <Td>Son tarihten önce geçerli nihai karar yok</Td>
              <Td className="font-mono">teminat × {formatBps(p.missPenaltyBps, 0)}</Td>
              <Td>yok</Td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Oy ağırlığı" description="Olasılık × Laplace ile yumuşatılmış zincir üstü isabet. Yeni bir ajan %50 ile başlar; isabeti ağırlığını yukarı ya da aşağı taşır.">
        <pre className="overflow-x-auto border border-rule bg-surface px-4 py-3 font-mono text-[12.5px] leading-5">
{`rep_i  = (correct_i + 1) × 10000 / (resolved_i + 2)
w_i    = probability_i × rep_i / 10000
support[choice_i] += w_i`}
        </pre>
      </Section>
    </>
  );
}
