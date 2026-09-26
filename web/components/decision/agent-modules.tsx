import { StatusMark, type Tone } from "@/components/ui/status";
import { explorer } from "@/lib/chain/monad";
import { formatBps, formatMon, shortHex } from "@/lib/format";
import type { AgentModuleView, AgentStatus } from "@/lib/view/decision-view";

const tone: Record<AgentStatus, Tone> = { pending: "neutral", processing: "wait", ok: "pass", failed: "fail", missed: "fail" };
const statusText: Record<AgentStatus, string> = { pending: "bekliyor", processing: "değerlendiriyor", ok: "karar verdi", failed: "başarısız", missed: "kaçırdı" };

function Status({ a }: { a: AgentModuleView }) {
  if (a.failure) return <StatusMark tone="fail">{a.failure.label}</StatusMark>;
  return (
    <StatusMark tone={tone[a.status]} live={a.status === "processing"}>
      {statusText[a.status]}
    </StatusMark>
  );
}

function Reason({ a }: { a: AgentModuleView }) {
  if (a.failure) {
    return (
      <div className="text-fail">
        <p>{a.failure.message}</p>
        {a.failure.details.length > 0 && (
          <details className="mt-1 text-ink-2">
            <summary className="cursor-pointer text-ink">{a.failure.details.length} ayrıntı</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11.5px]">
              {a.failure.details.slice(0, 12).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-1 text-[11.5px] text-ink-3">Karar yok; kaçırılmış sayılır.</p>
      </div>
    );
  }
  if (a.status === "missed") return <p className="text-fail">Son tarihten önce nihai karar gönderilmedi.</p>;
  if (a.status !== "ok") return <p className="text-ink-3">{a.status === "processing" ? "Durum, sorularına göre değerlendiriliyor…" : "—"}</p>;
  return (
    <div>
      {a.reason ? (
        <p className="text-ink-2">{a.reason}</p>
      ) : (
        <p className="text-ink-3" title={a.reasonHash ?? undefined}>
          Gerekçe metni yayımlanmadı; hash {a.reasonHash ? shortHex(a.reasonHash) : "—"}
        </p>
      )}
      {a.answers.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[12px] text-ink">Toplu gönderim · {a.answers.length + 1} yanıt</summary>
          <ul className="mt-1.5 space-y-1.5 border-l border-rule pl-3 text-[12px]">
            {a.answers.map((x) => (
              <li key={x.questionIndex}>
                <span className="font-mono text-ink">
                  Q{x.questionIndex} {x.category}
                </span>{" "}
                <span className="font-mono text-ink-2">
                  {x.choice} · {x.score} · {formatBps(x.probability, 0)}
                </span>
                {x.reason && <span className="block text-ink-2">{x.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The five analysts as analytical modules: identity and domain, status, the three Jev
 * primitives, the bond backing them, and the reason. Failures are shown in place.
 */
export function AgentModules({ agents }: { agents: AgentModuleView[] }) {
  return (
    <div className="border border-rule bg-surface">
      <div className="hidden grid-cols-[minmax(170px,1.1fr)_120px_96px_64px_76px_96px_minmax(260px,2.4fr)] gap-x-4 border-b border-rule bg-surface-2 px-4 py-2 lg:grid">
        {["Ajan · alan", "Durum", "Seçim", "Skor", "Olas.", "Teminat (MON)", "Gerekçe"].map((h, i) => (
          <span key={h} className={`label ${i >= 3 && i <= 5 ? "text-right" : ""}`}>
            {h}
          </span>
        ))}
      </div>
      <ul>
        {agents.map((a) => (
          <li
            key={a.key}
            className={`border-b border-rule px-4 py-3 last:border-b-0 ${a.status === "processing" ? "dm-progress" : ""} ${
              a.status === "failed" || a.status === "missed" ? "bg-[color-mix(in_srgb,var(--fail)_5%,transparent)]" : ""
            }`}
          >
            <div key={a.status} className="dm-arrive grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[13px] lg:grid-cols-[minmax(170px,1.1fr)_120px_96px_64px_76px_96px_minmax(260px,2.4fr)] lg:items-start">
              <div className="min-w-0">
                <p className="font-medium">{a.name}</p>
                <p className="text-[12px] text-ink-2">{a.domain}</p>
                {a.tx && (
                  <a href={explorer.tx(a.tx.hash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-ink-3 underline decoration-rule underline-offset-2 hover:text-ink">
                    submitBatch {shortHex(a.tx.hash, 4, 4)}
                  </a>
                )}
              </div>
              <div className="justify-self-end lg:justify-self-start">
                <Status a={a} />
              </div>
              {/* primitives: a compact row on small screens, columns on large */}
              <dl className="col-span-2 grid grid-cols-4 gap-2 font-mono text-[13px] lg:contents">
                <div className="lg:block">
                  <dt className="label lg:hidden">Seçim</dt>
                  <dd>{a.choice ?? <span className="text-ink-3">—</span>}</dd>
                </div>
                <div className="lg:text-right">
                  <dt className="label lg:hidden">Skor</dt>
                  <dd className="tabular">{a.score ?? <span className="text-ink-3">—</span>}</dd>
                </div>
                <div className="lg:text-right">
                  <dt className="label lg:hidden">Olas.</dt>
                  <dd className="tabular">{a.probability !== null ? formatBps(a.probability, 0) : <span className="text-ink-3">—</span>}</dd>
                </div>
                <div className="lg:text-right">
                  <dt className="label lg:hidden">Teminat</dt>
                  <dd className="tabular">{a.bond ? formatMon(BigInt(a.bond), 3) : <span className="text-ink-3">—</span>}</dd>
                </div>
              </dl>
              <div className="col-span-2 min-w-0 text-[12.5px] leading-5 lg:col-span-1">
                <Reason a={a} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
