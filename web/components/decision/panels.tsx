import type { ReactNode } from "react";
import { StateTable } from "@/components/domain/state-table";
import { Hash } from "@/components/ui/hash";
import { KeyValue, Panel } from "@/components/ui/layout";
import { StatusMark, type Tone } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { formatBps, formatMon, formatUtc } from "@/lib/format";
import type { DecisionView, TxView } from "@/lib/view/decision-view";

const muted = (s: string) => <span className="text-ink-3">{s}</span>;

// ─── Aggregation + threshold ────────────────────────────────────────────────

/** Weighted support per fork (numbers from the engine or the identical local rules) and the three gates. */
export function AggregationPanel({ v }: { v: DecisionView }) {
  const g = v.aggregation;
  if (!g) {
    return (
      <Panel title="Aggregation & threshold">
        <p className="px-4 py-4 text-[13px] text-ink-3">Not aggregated yet. Aggregation is deterministic integer arithmetic over the agents&apos; final decisions.</p>
      </Panel>
    );
  }
  const total = BigInt(g.total);
  const threshold = v.threshold.thresholdBps / 100;
  return (
    <Panel title="Aggregation & threshold">
      <ul className="space-y-2.5 px-4 pt-4">
        {g.support.map(({ fork, value }, i) => {
          const pct = total === 0n ? 0 : Number((BigInt(value) * 10_000n) / total) / 100;
          const lead = fork === g.leading;
          return (
            <li key={fork} className="dm-arrive grid grid-cols-[86px_1fr_64px] items-center gap-3">
              <span className={`font-mono text-[12px] ${lead ? "text-ink" : "text-ink-2"}`}>{fork}</span>
              <div className="relative h-2.5 bg-surface-2">
                <div className="h-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%`, background: `var(--fork-${i})` }} />
                <div aria-hidden className="absolute -inset-y-1 w-px bg-accent" style={{ left: `${threshold}%` }} />
              </div>
              <span className="text-right font-mono text-[12px] tabular">{pct.toFixed(1)} %</span>
            </li>
          );
        })}
      </ul>
      <p className="px-4 pb-3 pt-2 text-[11.5px] text-ink-3">
        <span aria-hidden className="mr-1.5 inline-block h-2 w-px translate-y-px bg-accent" />
        threshold {threshold.toFixed(0)} % · weight = probability × on-chain accuracy · total {g.total}
      </p>
      <KeyValue
        rows={[
          { k: "Quorum", v: <Gate ok={g.gates ? g.gates.quorum : g.submissions >= v.threshold.quorum}>{`${g.submissions} decisions · quorum ${v.threshold.quorum}`}</Gate> },
          {
            k: "Support share",
            v: <Gate ok={g.gates ? g.gates.share : g.passed}>{`${g.supportShareBps === null ? "—" : formatBps(g.supportShareBps, 1)} ≥ ${formatBps(v.threshold.thresholdBps, 0)}`}</Gate>,
          },
          {
            k: "Action score",
            v:
              g.leading === "DERISK" || g.leading === "DEPLOY" ? (
                <Gate ok={g.gates ? g.gates.score : g.passed}>{`${g.aggregateScore ?? "—"} ≥ ${v.threshold.minActionScore}`}</Gate>
              ) : (
                muted(`not required for ${g.leading}`)
              ),
          },
          { k: "Verdict", v: <StatusMark tone={g.passed ? "pass" : "fail"}>{g.passed ? "threshold passed" : "not met → NO_ACTION"}</StatusMark> },
        ]}
      />
    </Panel>
  );
}

function Gate({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <StatusMark tone={ok ? "pass" : "fail"}>{ok ? "pass" : "fail"}</StatusMark>
      <span className="font-mono text-[12.5px]">{children}</span>
    </span>
  );
}

// ─── Action + execution ─────────────────────────────────────────────────────

export function ActionPanel({ v }: { v: DecisionView }) {
  const e = v.execution;
  return (
    <Panel title="Bounded action & execution">
      <KeyValue
        rows={[
          {
            k: "Approved action",
            v: v.action ? (
              <span>
                <span className="font-mono">{v.action.fork}</span> <span className="text-ink-2">· {v.action.alias} · {v.action.approvedBy}</span>
                <span className="block text-[12px] text-ink-2">{v.action.effect}</span>
              </span>
            ) : v.aggregation?.guardianRequired ? (
              "awaiting guardian (escalated)"
            ) : (
              muted("not approved yet")
            ),
          },
          {
            k: "Execution",
            v: (
              <StatusMark tone={e.status === "executed" ? "pass" : e.status === "awaiting" ? "wait" : "neutral"}>
                {e.status === "executed" ? "executed" : e.status === "awaiting" ? "awaiting" : e.status === "not-submitted" ? "not submitted" : "—"}
              </StatusMark>
            ),
          },
          ...(e.status !== "executed" && e.detail !== "—" ? [{ k: "Detail", v: <span className="text-[12.5px] text-ink-2">{e.detail}</span> }] : []),
          ...(e.amountMoved !== null ? [{ k: "Amount moved", v: <span className="font-mono">{formatMon(BigInt(e.amountMoved))} MON</span> }] : []),
          ...(e.after ? [{ k: "Buckets after", v: <span className="font-mono text-[12.5px]">ACTIVE {formatMon(BigInt(e.after.active))} · RESERVE {formatMon(BigInt(e.after.reserve))}</span> }] : []),
          ...(e.startPrice ? [{ k: "Start price", v: <span className="font-mono">{e.startPrice} USD</span> }] : []),
          ...(e.txs.length ? [{ k: "Transactions", v: <TxList txs={e.txs} /> }] : []),
        ]}
      />
    </Panel>
  );
}

export function TxList({ txs }: { txs: TxView[] }) {
  return (
    <ul className="space-y-0.5 font-mono text-[12px]">
      {txs.map((t, i) => (
        <li key={`${t.hash}-${i}`} className="dm-arrive">
          <a href={explorer.tx(t.hash)} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-ink">
            {t.contract}.{t.functionName}
          </a>{" "}
          <span className="text-ink-3">{t.hash.slice(0, 10)}…</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Outcome + settlement ───────────────────────────────────────────────────

export function OutcomePanel({ v }: { v: DecisionView }) {
  const o = v.outcome;
  const tone: Tone = o.status === "verified" ? (o.success ? "pass" : "fail") : o.status === "pending" ? "wait" : "neutral";
  return (
    <Panel title="Outcome (verify)">
      <KeyValue
        rows={[
          { k: "Status", v: <StatusMark tone={tone}>{o.status === "verified" ? (o.success ? "verified · success" : "verified · miss") : o.status}</StatusMark> },
          ...(o.status === "verified"
            ? [
                { k: "Expected action", v: <span className="font-mono">{o.expectedAction}</span> },
                { k: "Observed result", v: <span className="font-mono">{o.observed}</span> },
                { k: "Price", v: <span className="font-mono text-[12.5px]">{o.startPrice} → {o.endPrice} USD ({o.moveBps} bps)</span> },
                { k: "Source", v: <span className="text-[12.5px]">{o.source}</span> },
                { k: "Resolved", v: <span className="font-mono text-[12.5px]">{o.resolvedAt ? formatUtc(o.resolvedAt) : "—"}</span> },
              ]
            : [{ k: "Detail", v: <span className="text-[12.5px] text-ink-2">{o.detail}</span> }]),
        ]}
      />
    </Panel>
  );
}

const resultTone = (r: string | null): Tone => (r === "CORRECT" ? "pass" : r === "NEUTRAL" || r === null ? "neutral" : "fail");

export function SettlementPanel({ v }: { v: DecisionView }) {
  const s = v.settlement;
  if (s.lines.length === 0) {
    return (
      <Panel title="Settlement">
        <p className="px-4 py-4 text-[13px] text-ink-2">
          <span className="mr-2 font-mono text-ink">{s.status === "na" ? "N/A" : s.status}</span>
          {s.detail}
        </p>
      </Panel>
    );
  }
  const settled = s.status === "SETTLED";
  return (
    <Table caption="Settlement">
      <thead>
        <tr>
          <Th>Agent</Th>
          <Th>Result</Th>
          <Th align="right">Bond</Th>
          <Th align="right">Penalty</Th>
          <Th align="right">Reward</Th>
          <Th align="right">Net</Th>
        </tr>
      </thead>
      <tbody>
        {s.lines.map((l) => {
          const net = BigInt(l.net);
          return (
            <tr key={l.agentId}>
              <Td className="whitespace-nowrap font-medium">{l.name}</Td>
              <Td>{l.result ? <StatusMark tone={resultTone(l.result)}>{l.result}</StatusMark> : <span className="text-[12px] text-ink-3">{s.status.toLowerCase()}</span>}</Td>
              <Td align="right" mono>{formatMon(BigInt(l.bond))}</Td>
              {settled ? (
                <>
                  <Td align="right" mono>{formatMon(BigInt(l.penalty))}</Td>
                  <Td align="right" mono>{formatMon(BigInt(l.reward))}</Td>
                  <Td align="right" mono className={net > 0n ? "text-pass" : net < 0n ? "text-fail" : ""}>
                    {net < 0n ? `−${formatMon(-net)}` : `+${formatMon(net)}`}
                  </Td>
                </>
              ) : (
                <Td colSpan={3} align="right" className="text-[12px] text-ink-3">
                  {s.status === "LOCKED" ? "until the outcome is verified" : "returned in full"}
                </Td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

// ─── State + questions ─────────────────────────────────────────────────────

export function StatePanel({ v, withInputs = true }: { v: DecisionView; withInputs?: boolean }) {
  const s = v.state;
  return (
    <div className="space-y-4">
      <Panel>
        <KeyValue
          rows={[
            { k: "State id", v: s.stateId ? <span className="font-mono text-[12.5px]">{s.stateId}</span> : muted("payload not available") },
            { k: "State hash", v: s.hash ? <Hash value={s.hash} full /> : muted("—") },
            { k: "Observed", v: s.timestamp ? <span className="font-mono text-[12.5px]">{formatUtc(s.timestamp)}</span> : muted("—") },
            { k: "Sources", v: s.sources.length ? <span className="font-mono text-[12.5px]">{s.sources.join(" · ")}</span> : muted("—") },
            { k: "Inputs", v: s.total !== null ? `${s.available} of ${s.total} available` : muted("payload not available; only the hash is on-chain") },
          ]}
        />
      </Panel>
      {withInputs && s.inputs && <StateTable inputs={s.inputs} />}
    </div>
  );
}

export function QuestionsPanel({ v }: { v: DecisionView }) {
  const items = v.questions.items;
  if (!items) {
    return (
      <Panel>
        <KeyValue rows={[{ k: "Questions hash", v: v.questions.hash ? <Hash value={v.questions.hash} full /> : muted("—") }, { k: "Questions", v: muted("payload not available; only the hash is on-chain") }]} />
      </Panel>
    );
  }
  return (
    <ol className="border border-rule bg-surface">
      {items.map((q) => (
        <li key={q.questionId} className="grid grid-cols-[44px_1fr] gap-x-3 border-b border-rule px-4 py-3 last:border-b-0 md:grid-cols-[44px_110px_1fr_190px]">
          <span className="font-mono text-[12px] text-ink-3">Q{q.index}</span>
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-2 max-md:hidden">{q.category}</span>
          <div className="min-w-0">
            <p className="text-[13.5px]">{q.text}</p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-3">{q.questionId}</p>
          </div>
          <div className="col-start-2 text-[12px] text-ink-2 md:col-start-auto md:text-right">
            <p>{q.answeredBy.length === 5 ? "all five agents" : q.answeredBy.join(", ")}</p>
            <p className="font-mono text-ink-3">
              {q.availableInputs}/{q.inputs} inputs
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Transactions + integrity ──────────────────────────────────────────────

export function TransitionsTable({ v }: { v: DecisionView }) {
  if (v.transitions.length === 0) return null;
  return (
    <Table caption="Lifecycle transactions">
      <thead>
        <tr>
          <Th>Status</Th>
          <Th>Call</Th>
          <Th align="right">Block</Th>
          <Th>Transaction</Th>
        </tr>
      </thead>
      <tbody>
        {v.transitions.map((t) => (
          <tr key={t.status}>
            <Td mono>{t.status}</Td>
            <Td mono className="text-ink-2">{t.tx ? `${t.tx.contract}.${t.tx.functionName}` : "log not readable"}</Td>
            <Td align="right" mono>
              <a href={explorer.block(BigInt(t.blockNumber))} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                {t.blockNumber}
              </a>
            </Td>
            <Td>{t.tx ? <Hash value={t.tx.hash} href={explorer.tx(t.tx.hash)} /> : muted("—")}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function IntegrityPanel({ v }: { v: DecisionView }) {
  if (v.integrity.length === 0) return null;
  const tone = { VERIFIED: "pass", MISMATCH: "fail", UNAVAILABLE: "neutral" } as const;
  return (
    <Table caption="Integrity checks">
      <thead>
        <tr>
          <Th>Payload</Th>
          <Th>On-chain commitment</Th>
          <Th>Result</Th>
        </tr>
      </thead>
      <tbody>
        {v.integrity.map((c) => (
          <tr key={c.label}>
            <Td>{c.label}</Td>
            <Td>{c.onChain ? <Hash value={c.onChain} /> : muted("—")}</Td>
            <Td>
              <StatusMark tone={tone[c.status]}>{c.status.toLowerCase()}</StatusMark>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
