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
          ...(e.after && e.amountMoved !== null && v.action
            ? [
                {
                  k: "Vault before → after",
                  v: (() => {
                    const moved = BigInt(e.amountMoved!);
                    const after = { a: BigInt(e.after!.active), r: BigInt(e.after!.reserve) };
                    const before = v.action!.fork === "DERISK" ? { a: after.a + moved, r: after.r - moved } : v.action!.fork === "DEPLOY" ? { a: after.a - moved, r: after.r + moved } : after;
                    return (
                      <span className="font-mono text-[12.5px]">
                        ACTIVE {formatMon(before.a)} → {formatMon(after.a)}
                        <span className="block">RESERVE {formatMon(before.r)} → {formatMon(after.r)}</span>
                      </span>
                    );
                  })(),
                },
              ]
            : []),
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
  const rep = v.settlement.reproduction;
  if (o.status !== "verified") {
    return (
      <Panel title="Outcome (verify)">
        <KeyValue
          rows={[
            { k: "Status", v: <StatusMark tone={tone}>{o.status}</StatusMark> },
            { k: "Detail", v: <span className="text-[12.5px] text-ink-2">{o.detail}</span> },
          ]}
        />
      </Panel>
    );
  }
  return (
    <div className="border border-rule bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="text-[13px] font-semibold">Outcome (verify)</span>
        <StatusMark tone={tone}>{o.success ? "success · expected = observed" : "miss · expected ≠ observed"}</StatusMark>
      </div>
      <div className="grid grid-cols-[96px_1fr_1fr] gap-x-3 border-b border-rule bg-surface-2 px-4 py-2">
        <span />
        <span className="label">Expected</span>
        <span className="label">Observed</span>
      </div>
      {[
        ["Action", <span key="e" className="font-mono">{o.expectedAction}</span>, <span key="o" className={`font-mono ${o.success ? "text-pass" : "text-fail"}`}>{o.observed}</span>],
        ["Price", <span key="s" className="font-mono text-[12.5px]">{o.startPrice} USD <span className="block text-ink-3">at execution</span></span>, <span key="n" className="font-mono text-[12.5px]">{o.endPrice} USD <span className="block text-ink-3">after horizon</span></span>],
        ["Move", <span key="b" className="font-mono text-[12.5px] text-ink-2">band ±{o.bandBps ?? "—"} bps</span>, <span key="m" className="font-mono text-[12.5px]">{o.moveBps} bps</span>],
      ].map(([k, e, obs]) => (
        <div key={String(k)} className="grid grid-cols-[96px_1fr_1fr] gap-x-3 border-b border-rule px-4 py-2">
          <span className="label self-center">{k}</span>
          {e}
          {obs}
        </div>
      ))}
      <KeyValue
        rows={[
          { k: "Verification source", v: <span className="text-[12.5px]">{o.source}</span> },
          { k: "Recorded", v: <span className="font-mono text-[12.5px]">{o.resolvedAt ? formatUtc(o.resolvedAt) : "—"}</span> },
          ...(rep
            ? [
                {
                  k: "Recomputed",
                  v: <StatusMark tone={rep.outcomeMatches ? "pass" : "fail"}>{rep.outcomeMatches ? "matches the recorded outcome" : "differs from the recorded outcome"}</StatusMark>,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

const resultTone = (r: string | null): Tone => (r === "CORRECT" ? "pass" : r === "NEUTRAL" || r === null ? "neutral" : "fail");

function signed(wei: bigint) {
  return wei < 0n ? `−${formatMon(-wei)}` : `+${formatMon(wei)}`;
}

/** One sentence that ties the prediction to the outcome and to the money. */
function consequence(l: DecisionView["settlement"]["lines"][number]): string {
  if (!l.result) return "";
  const net = BigInt(l.net);
  const prediction = l.choice ? `Predicted ${l.choice} with ${formatBps(l.probability ?? 0, 0)} confidence` : "Submitted no final decision";
  const outcome = l.observed ? `the outcome made ${l.observed} correct` : "the outcome was recorded";
  const effect =
    l.result === "CORRECT"
      ? `rewarded ${formatMon(BigInt(l.reward))} MON`
      : l.result === "WRONG"
        ? `penalised ${formatMon(BigInt(l.penalty))} MON`
        : l.result === "MISSED"
          ? `penalised ${formatMon(BigInt(l.penalty))} MON for missing`
          : "bond returned unchanged";
  return `${prediction}; ${outcome}; ${l.result.toLowerCase()} → ${effect} (net ${signed(net)} MON).`;
}

/**
 * Settlement as accountability: per agent, what it predicted, what happened, whether it was
 * right, and how its bond changed — with the deterministic rule behind every number and a
 * check that recomputing it from on-chain inputs gives exactly what the contract recorded.
 */
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
  const rep = s.reproduction;
  return (
    <div className="border border-rule bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="text-[13px] font-semibold">Settlement</span>
        {settled && rep ? (
          <StatusMark tone={rep.matches ? "pass" : "fail"}>{rep.matches ? "reproduced · matches" : "reproduction differs"}</StatusMark>
        ) : (
          <StatusMark tone={settled ? "pass" : "wait"}>{s.status.toLowerCase()}</StatusMark>
        )}
      </div>
      <div className="hidden grid-cols-[minmax(130px,1fr)_minmax(150px,1.2fr)_110px_110px_repeat(4,minmax(74px,auto))] gap-x-4 border-b border-rule bg-surface-2 px-4 py-2 md:grid">
        {["Agent", "Predicted", "Actual", "Result", "Bond", "Penalty", "Reward", "Final"].map((h, i) => (
          <span key={h} className={`label ${i >= 4 ? "text-right" : ""}`}>
            {h}
          </span>
        ))}
      </div>
      <ul>
        {s.lines.map((l) => {
          const net = BigInt(l.net);
          return (
            <li key={l.agentId} className="border-b border-rule px-4 py-3 last:border-b-0">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] md:grid-cols-[minmax(130px,1fr)_minmax(150px,1.2fr)_110px_110px_repeat(4,minmax(74px,auto))]">
                <div className="col-span-2 font-medium md:col-span-1">{l.name}</div>
                <Cell k="Predicted">
                  {l.choice ? (
                    <span className="font-mono">
                      {l.choice}
                      <span className="block text-[11.5px] text-ink-3">
                        score {l.score} · p {formatBps(l.probability ?? 0, 0)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-3">no decision</span>
                  )}
                </Cell>
                <Cell k="Actual">{l.observed ? <span className="font-mono">{l.observed}</span> : <span className="text-ink-3">{settled ? "—" : "pending"}</span>}</Cell>
                <Cell k="Result">{l.result ? <StatusMark tone={resultTone(l.result)}>{l.result}</StatusMark> : <span className="text-[12px] text-ink-3">{s.status.toLowerCase()}</span>}</Cell>
                <Cell k="Bond" right>{formatMon(BigInt(l.bond))}</Cell>
                <Cell k="Penalty" right>{settled ? formatMon(BigInt(l.penalty)) : "—"}</Cell>
                <Cell k="Reward" right>{settled ? formatMon(BigInt(l.reward)) : "—"}</Cell>
                <Cell k="Final" right>
                  {settled ? (
                    <span className={net > 0n ? "text-pass" : net < 0n ? "text-fail" : ""}>
                      {formatMon(BigInt(l.returned))}
                      <span className="block text-[11.5px]">{signed(net)}</span>
                    </span>
                  ) : (
                    <span className="text-ink-3">{s.status === "LOCKED" ? "locked" : "returned"}</span>
                  )}
                </Cell>
              </div>
              {settled && (
                <p className="mt-2 text-[12px] text-ink-2">
                  {consequence(l)}
                  {l.formula && (
                    <span className="mt-0.5 block font-mono text-[11.5px] text-ink-3">
                      rule: {l.formula}
                      {l.reproduced === false && <span className="text-fail"> · differs from the contract</span>}
                    </span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {settled && rep && (
        <p className="border-t border-rule px-4 py-2 text-[11.5px] text-ink-3">
          Outcome and settlement recomputed from on-chain inputs with the protocol rules and compared with what the contract recorded. Recomputed with OutcomeRegistry&apos;s current parameters (slash {formatBps(rep.params.slashBps, 0)}, miss {formatBps(rep.params.missPenaltyBps, 0)}).
          {!rep.matches && ` ${rep.mismatches.join("; ")}. If an admin changed a parameter after settlement, the recorded values stand.`}
          {" "}Final = bond − penalty + reward, credited to the agent&apos;s free bond on-chain.
        </p>
      )}
    </div>
  );
}

function Cell({ k, children, right = false }: { k: string; children: React.ReactNode; right?: boolean }) {
  return (
    <div className={`min-w-0 ${right ? "md:text-right" : ""}`}>
      <p className="label md:hidden">{k}</p>
      <div className={right ? "font-mono tabular" : ""}>{children}</div>
    </div>
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
