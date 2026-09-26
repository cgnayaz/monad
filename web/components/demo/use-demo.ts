"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWalletTx } from "@/components/wallet/use-wallet-tx";
import { DEFAULT_PARAMS } from "@/lib/decmarkt/params";
import { settle } from "@/lib/decmarkt/settlement";
import type { Wire } from "@/lib/engine/wire";
import { AGENTS } from "@/lib/jev/agents";
import { correctFork, moveBps } from "@/lib/jev/move";
import type { Settlement } from "@/lib/model/accountability";
import type { PipelineEvent } from "@/lib/model/final-decision";
import { toProbability } from "@/lib/model/primitives";
import { formatPrice } from "@/lib/format";
import type { Fork } from "@/lib/types/protocol";
import { fromRound, type DecisionView, type RoundProgress } from "@/lib/view/decision-view";
import { saveLastRound } from "@/lib/view/last-round";

/**
 * The judge-facing demo as a state machine over the real pipeline:
 *
 *  1 STATE · 2 QUESTIONS · 3 PARALLEL · 4 PRIMITIVES · 5 BATCH · 6 FORKS · 7 AGGREGATION
 *  8 ACTION · 9 MONAD · 10 VERIFY · 11 SETTLEMENT
 *
 * Steps 1–7 come from the pipeline stream. In live mode steps 8–11 are on-chain (wallet or
 * keeper executes, keeper resolves, the chain is read back). In simulation mode no
 * transaction exists: the action is applied to a local model, the outcome is observed from
 * the real Pyth price after the horizon, and settlement is computed with the contract's
 * formula on notional bonds. A failing step stops the lifecycle and can be retried.
 */

export type DemoMode = "simulation" | "live";
export const STEPS = ["STATE", "QUESTIONS", "PARALLEL", "PRIMITIVES", "BATCH", "FORKS", "AGGREGATION", "ACTION", "MONAD", "VERIFY", "SETTLEMENT"] as const;
export type StepKey = (typeof STEPS)[number];
export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped" | "stopped";
export interface StepState {
  status: StepStatus;
  note?: string;
  error?: string;
}

export interface ChainTx {
  label: string;
  hash: `0x${string}` | null;
  status: "pending" | "confirmed" | "failed";
  detail?: string;
}

export interface PriceObs {
  price: string;
  expo: number;
  publishTime: number;
}

export interface VerifyResult {
  expected: Fork;
  observed: Fork;
  success: boolean;
  startPrice: string; // display (USD)
  endPrice: string;
  startTime: number | null;
  endTime: number | null;
  moveBps: string;
  bandBps: number;
  source: "chain" | "pyth-offchain" | "example";
}

/** Illustrative price paths for explaining verification when no real price is available. */
export type ExampleMove = "down" | "flat" | "up";

type WEvent = Wire<PipelineEvent>;

const empty = (): RoundProgress => ({ state: null, questions: null, runs: {}, running: {}, submissions: {}, decision: null });
const initialSteps = () => Object.fromEntries(STEPS.map((s) => [s, { status: "pending" }])) as Record<StepKey, StepState>;
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `İstek başarısız (${res.status})`);
  return body;
}

/** Settlement with OutcomeRegistry's formula on notional bonds; nothing is locked or transferred. */
function notionalSettlement(d: NonNullable<RoundProgress["decision"]>, observed: Exclude<Fork, "ESCALATE">): Settlement {
  const bond = BigInt(d.parameters.lockPerAgent);
  const participants = AGENTS.map((a) => {
    const out = d.agents.find((x) => x.agentId === a.agentId);
    return {
      agentId: a.agentId,
      bond,
      submission: out && out.status === "ok" ? { choice: out.final.choice, probability: toProbability(out.final.probability) } : null,
    };
  });
  return settle("0", participants, observed, { slashBps: DEFAULT_PARAMS.slashBps, missPenaltyBps: DEFAULT_PARAMS.missPenaltyBps, roundReward: DEFAULT_PARAMS.roundReward });
}

export function useDemo() {
  const [mode, setMode] = useState<DemoMode>("simulation");
  const [steps, setSteps] = useState(initialSteps);
  const [progress, setProgress] = useState<RoundProgress>(empty);
  const [chainView, setChainView] = useState<DecisionView | null>(null);
  const [txs, setTxs] = useState<ChainTx[]>([]);
  const [simExecution, setSimExecution] = useState<{ fork: Fork; start: PriceObs } | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [simSettlement, setSimSettlement] = useState<Settlement | null>(null);
  /** Why no real price could be read (simulation only); enables the labelled example scenario. */
  const [priceMissing, setPriceMissing] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<{ label: string; until: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [parallelStartedAt, setParallelStartedAt] = useState<number | null>(null);
  const cancelled = useRef(false);

  const walletTx = useWalletTx();

  const set = useCallback((key: StepKey, s: StepState) => setSteps((prev) => ({ ...prev, [key]: s })), []);
  const fail = useCallback((key: StepKey, error: string) => {
    setSteps((prev) => {
      const next = { ...prev, [key]: { status: "failed" as const, error } };
      // Stop the lifecycle: every later step is marked stopped.
      for (const k of STEPS.slice(STEPS.indexOf(key) + 1)) if (next[k].status === "pending" || next[k].status === "active") next[k] = { status: "stopped" };
      return next;
    });
    setCountdown(null);
    setRunning(false);
  }, []);

  const roundView = useMemo(() => fromRound(progress), [progress]);
  const decision = progress.decision;
  const decisionId = decision?.mode === "live" ? decision.decisionId : null;

  const addTx = (t: ChainTx) => setTxs((prev) => [...prev.filter((x) => x.label !== t.label), t]);

  // ─── Steps 1–7: the pipeline stream ──────────────────────────────────────
  const onEvent = useCallback(
    (e: WEvent, m: DemoMode) => {
      switch (e.type) {
        case "stage":
          setProgress((p) => ({ ...p, running: { ...p.running, [e.stage]: e.status } }));
          if (e.stage === "STATE" && e.status === "running") set("STATE", { status: "active" });
          if (e.stage === "QUESTIONS" && e.status === "running") set("QUESTIONS", { status: "active" });
          if (e.stage === "COMMIT" && e.status === "done") {
            for (const t of e.txs ?? []) addTx({ label: t.functionName, hash: t.hash, status: "confirmed", detail: "hiçbir ajan çalışmadan önce" });
            set("MONAD", { status: "active", note: "durum ve soru hash'leri zincire işlendi" });
          }
          if (e.stage === "PARALLEL_DECISIONS" && e.status === "running") {
            setParallelStartedAt(Date.now());
            set("PARALLEL", { status: "active" });
          }
          if (e.stage === "PARALLEL_DECISIONS" && (e.status === "done" || e.status === "failed")) {
            set("PARALLEL", { status: "done", note: e.detail });
            set("PRIMITIVES", { status: "done" });
            set("BATCH", { status: "done" });
            set("FORKS", { status: "done" });
          }
          if (e.stage === "AGGREGATION" && e.status === "running") set("AGGREGATION", { status: "active" });
          if (e.stage === "EXECUTION" && m === "live") for (const t of e.txs ?? []) addTx({ label: t.functionName, hash: t.hash, status: "confirmed" });
          break;
        case "state":
          setProgress((p) => ({ ...p, state: e.state }));
          set("STATE", { status: "done" });
          break;
        case "questions":
          setProgress((p) => ({ ...p, questions: e.questions }));
          set("QUESTIONS", { status: "done" });
          break;
        case "agent":
          setProgress((p) => ({ ...p, runs: { ...p.runs, [e.run.agentKey]: e.run } }));
          break;
        case "submission":
          setProgress((p) => ({ ...p, submissions: { ...p.submissions, [e.agentId]: e.tx } }));
          addTx({
            label: `submitBatch · ${AGENTS.find((a) => a.agentId === e.agentId)?.name ?? e.agentId}`,
            hash: e.tx?.hash ?? null,
            status: e.tx ? "confirmed" : "failed",
            detail: e.error ?? undefined,
          });
          break;
        case "result":
          setProgress((p) => ({ ...p, decision: e.decision }));
          set("AGGREGATION", { status: "done" });
          break;
        case "error":
          break;
      }
    },
    [set],
  );

  // ─── Step 8–11, simulation ───────────────────────────────────────────────
  const simulateFrom = useCallback(
    async (from: "ACTION" | "VERIFY", d: NonNullable<RoundProgress["decision"]>, execution: { fork: Fork; start: PriceObs } | null) => {
      let exec = execution;
      if (from === "ACTION") {
        if (!d.action) return fail("ACTION", "Onaylanan eylem yok (guardian bekleniyor); simülasyon burada durur.");
        set("ACTION", { status: "active" });
        try {
          const start = await json<PriceObs>(await fetch("/api/oracle/price", { cache: "no-store" }));
          exec = { fork: d.action.fork, start };
          setSimExecution(exec);
          set("ACTION", { status: "done", note: `yerel kasa modeline ${start.publishTime} yayın zamanında uygulandı` });
          set("MONAD", { status: "skipped", note: "simülasyon modu işlem göndermez" });
        } catch (err) {
          // No real price: the decision itself is complete and real; verification cannot run.
          // Stop cleanly and offer the clearly labelled example scenario instead of failing.
          setPriceMissing((err as Error).message);
          set("ACTION", { status: "done", note: "karar onaylandı; gerçek fiyat olmadığı için kasa modeline uygulanmadı" });
          set("MONAD", { status: "skipped", note: "simülasyon modu işlem göndermez" });
          set("VERIFY", { status: "active", note: "gerçek fiyat verisi yok" });
          setRunning(false);
          return;
        }
      }
      if (!exec) return;
      // VERIFY: wait for the horizon, then observe the real published price.
      set("VERIFY", { status: "active" });
      const t0 = exec.start.publishTime + d.parameters.horizon;
      setCountdown({ label: "ufuk", until: t0 + 2, total: d.parameters.horizon });
      while (nowSec() < t0 + 2) {
        if (cancelled.current) return;
        await sleep(500);
      }
      setCountdown(null);
      let end: PriceObs;
      try {
        end = await json<PriceObs>(await fetch(`/api/oracle/price?at=${t0}`, { cache: "no-store" }));
      } catch (err) {
        return fail("VERIFY", `Gözlenen fiyat alınamadı: ${(err as Error).message}`);
      }
      if (end.expo !== exec.start.expo) return fail("VERIFY", "Gözlemler arasında fiyat üssü değişti");
      const observed = correctFork(BigInt(exec.start.price), BigInt(end.price), d.parameters.bandBps);
      const result: VerifyResult = {
        expected: exec.fork,
        observed,
        success: observed === exec.fork,
        startPrice: formatPrice(BigInt(exec.start.price), exec.start.expo),
        endPrice: formatPrice(BigInt(end.price), end.expo),
        startTime: exec.start.publishTime,
        endTime: end.publishTime,
        moveBps: moveBps(BigInt(exec.start.price), BigInt(end.price)).toString(),
        bandBps: d.parameters.bandBps,
        source: "pyth-offchain",
      };
      setVerify(result);
      set("VERIFY", { status: "done" });

      setSimSettlement(notionalSettlement(d, observed));
      set("SETTLEMENT", { status: "done", note: "itibari teminatlar; hiçbir şey transfer edilmez" });
      setRunning(false);
    },
    [fail, set],
  );

  /**
   * Explain verification and settlement with an illustrative price move when no real price
   * exists. Everything produced here is marked source "example" and labelled in the UI; the
   * agents' decisions it is applied to are the real ones from this round.
   */
  const runExample = useCallback(
    (move: ExampleMove) => {
      const d = progress.decision;
      if (!d?.action) return;
      const expo = -8;
      const start = 300_000_000_000n; // 3,000.00 USD, illustrative
      const deltaBps = move === "down" ? -50n : move === "up" ? 50n : 2n;
      const end = start + (start * deltaBps) / 10_000n;
      const observed = correctFork(start, end, d.parameters.bandBps);
      setVerify({
        expected: d.action.fork,
        observed,
        success: observed === d.action.fork,
        startPrice: formatPrice(start, expo),
        endPrice: formatPrice(end, expo),
        startTime: null,
        endTime: null,
        moveBps: moveBps(start, end).toString(),
        bandBps: d.parameters.bandBps,
        source: "example",
      });
      set("VERIFY", { status: "done", note: "örnek senaryo — gerçek fiyat değil" });
      setSimSettlement(notionalSettlement(d, observed));
      set("SETTLEMENT", { status: "done", note: "örnek senaryo; itibari teminatlar" });
    },
    [progress.decision, set],
  );

  // ─── Step 8–11, live ─────────────────────────────────────────────────────
  const refreshChain = useCallback(async (id: string) => {
    const v = await json<DecisionView>(await fetch(`/api/decisions/${id}`, { cache: "no-store" }));
    setChainView(v);
    return v;
  }, []);

  const advance = useCallback(async (id: string) => json<{ step: string; status: string; tx: { hash: `0x${string}` } | null; note?: string }>(await fetch(`/api/decisions/${id}/advance`, { method: "POST" })), []);

  const liveVerifyAndSettle = useCallback(
    async (id: string) => {
      set("VERIFY", { status: "active" });
      let v: DecisionView;
      try {
        v = await refreshChain(id);
      } catch (err) {
        return fail("VERIFY", (err as Error).message);
      }
      const at = v.outcome.availableAt;
      if (at) {
        setCountdown({ label: "ufuk", until: at + 1, total: at + 1 - (v.execution.executedAt ?? at) });
        while (nowSec() < at + 1) {
          if (cancelled.current) return;
          await sleep(500);
        }
        setCountdown(null);
      }
      // The keeper resolves with a signed price published inside the window. Chain time may lag
      // wall time by a few seconds, so an early "Horizon not reached" is retried briefly.
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await advance(id);
          if (r.tx) addTx({ label: "OutcomeRegistry.resolve", hash: r.tx.hash, status: "confirmed" });
          break;
        } catch (err) {
          const msg = (err as Error).message;
          if (/Horizon not reached/.test(msg) && attempt < 10) {
            await sleep(3000);
            continue;
          }
          return fail("VERIFY", msg);
        }
      }
      try {
        v = await refreshChain(id);
      } catch (err) {
        return fail("VERIFY", (err as Error).message);
      }
      if (v.outcome.status !== "verified" && v.outcome.status !== "void") return fail("VERIFY", `Sonuç kaydedilmedi (durum ${v.status})`);
      setVerify(
        v.outcome.status === "verified"
          ? {
              expected: v.outcome.expectedAction!,
              observed: v.outcome.observed!,
              success: !!v.outcome.success,
              startPrice: v.outcome.startPrice ?? "—",
              endPrice: v.outcome.endPrice ?? "—",
              startTime: v.execution.executedAt,
              endTime: v.outcome.availableAt,
              moveBps: v.outcome.moveBps ?? "—",
              bandBps: progress.decision?.parameters.bandBps ?? 0,
              source: "chain",
            }
          : null,
      );
      set("VERIFY", { status: "done", note: v.outcome.status === "void" ? "geçersiz: teminatlar iade edildi" : undefined });
      set("SETTLEMENT", { status: "done" });
      setRunning(false);
    },
    [advance, fail, progress.decision?.parameters.bandBps, refreshChain, set],
  );

  /** Execute the approved action: from the connected wallet, or by the server keeper. */
  const executeLive = useCallback(
    async (via: "wallet" | "keeper") => {
      if (!decisionId || !decision?.action) return;
      set("MONAD", { status: "active", note: via === "wallet" ? "cüzdan onayı bekleniyor" : "keeper yürütüyor" });
      set("ACTION", { status: "active" });
      try {
        if (via === "keeper") {
          addTx({ label: "ExecutionVault.execute", hash: null, status: "pending", detail: "keeper" });
          const r = await advance(decisionId);
          if (r.step !== "execute" || !r.tx) throw new Error(r.note ?? `Beklenmeyen adım ${r.step}`);
          addTx({ label: "ExecutionVault.execute", hash: r.tx.hash, status: "confirmed", detail: "keeper" });
        } else {
          const receipt = await walletTx.run({ kind: "execute", decisionId });
          if (!receipt) throw new Error("wallet transaction did not confirm (see the transaction panel)");
          addTx({ label: "ExecutionVault.execute", hash: receipt.hash, status: "confirmed", detail: `cüzdan · blok ${receipt.blockNumber}` });
        }
        set("ACTION", { status: "done" });
        set("MONAD", { status: "done" });
      } catch (err) {
        const msg = (err as Error).message.split("\n")[0];
        addTx({ label: "ExecutionVault.execute", hash: null, status: "failed", detail: msg });
        return fail("MONAD", msg);
      }
      await liveVerifyAndSettle(decisionId);
    },
    [advance, decision?.action, decisionId, fail, liveVerifyAndSettle, set, walletTx],
  );

  // ─── Start / retry ──────────────────────────────────────────────────────
  const start = useCallback(async () => {
    cancelled.current = false;
    setSteps(initialSteps());
    setProgress(empty());
    setChainView(null);
    setTxs([]);
    setSimExecution(null);
    setVerify(null);
    setSimSettlement(null);
    setPriceMissing(null);
    setCountdown(null);
    setRunning(true);
    setStartedAt(Date.now());
    setParallelStartedAt(null);
    const m = mode;
    let result: NonNullable<RoundProgress["decision"]> | null = null;
    let lastActive: StepKey = "STATE";
    try {
      const res = await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: m }) });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const retry = res.headers.get("Retry-After");
        return fail("STATE", `${body?.error ?? `İstek başarısız (${res.status})`}${retry ? ` — ${retry} sn sonra tekrar deneyin` : ""}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as WEvent;
          if (e.type === "stage" && e.status === "running") {
            lastActive = ({ STATE: "STATE", QUESTIONS: "QUESTIONS", COMMIT: "MONAD", PARALLEL_DECISIONS: "PARALLEL", SUBMIT: "MONAD", AGGREGATION: "AGGREGATION", ACTION: "ACTION", EXECUTION: "MONAD" } as const)[e.stage];
          }
          if (e.type === "error") return fail(lastActive, e.message);
          if (e.type === "result") result = e.decision;
          onEvent(e, m);
        }
      }
    } catch (err) {
      return fail(lastActive, (err as Error).message);
    }
    if (!result) return fail(lastActive, "Tur sonuçsuz bitti");

    if (m === "simulation") return simulateFrom("ACTION", result, null);

    // Live: the pipeline stops at approval (or earlier when aggregation must wait).
    const ex = result.execution;
    if (ex.status !== "submitted") return fail("MONAD", ex.status === "not-submitted" ? ex.reason : "Gönderilmedi");
    if (ex.aggregationMatchesChain === false) return fail("AGGREGATION", ex.next?.reason ?? "Yerel toplama DecisionEngine ile uyuşmuyor");
    if (ex.next?.step === "aggregate") {
      set("AGGREGATION", { status: "active", note: "gönderim son tarihi bekleniyor" });
      const until = ex.next.availableAt ?? nowSec();
      setCountdown({ label: "gönderim penceresi", until, total: result.parameters.submissionWindow });
      while (nowSec() < until) {
        if (cancelled.current) return;
        await sleep(500);
      }
      setCountdown(null);
      try {
        const r = await advance(result.decisionId);
        if (r.tx) addTx({ label: "DecisionEngine.aggregate", hash: r.tx.hash, status: "confirmed" });
        const v = await refreshChain(result.decisionId);
        if (v.status === "CANCELLED") return fail("AGGREGATION", "Yeter sayı sağlanmadı; karar iptal edildi ve teminatlar iade edildi");
      } catch (err) {
        return fail("AGGREGATION", (err as Error).message);
      }
    } else if (ex.next?.step === "guardian") {
      set("ACTION", { status: "active", note: "ajanlar yükseltti; bir guardian seçmeli" });
      return fail("ACTION", "Yükseltildi: yürütmeden önce guardian kararı gerekli (guardian cüzdanını kullanın)");
    }
    set("ACTION", { status: "active", note: "onaylandı; yürütme bekleniyor" });
    set("MONAD", { status: "active", note: "yürütmeyi cüzdanınızda onaylayın ya da keeper yürütsün" });
    setRunning(false); // waiting for the user's choice
  }, [advance, fail, mode, onEvent, refreshChain, set, simulateFrom]);

  const retry = useCallback(async () => {
    const failed = STEPS.find((k) => steps[k].status === "failed");
    if (!failed) return;
    const d = progress.decision;
    cancelled.current = false;
    setRunning(true);
    if (d && mode === "simulation" && (failed === "ACTION" || failed === "VERIFY" || failed === "SETTLEMENT")) {
      setSteps((prev) => {
        const next = { ...prev };
        for (const k of STEPS.slice(STEPS.indexOf(failed))) next[k] = { status: "pending" };
        return next;
      });
      return simulateFrom(failed === "ACTION" ? "ACTION" : "VERIFY", d, simExecution);
    }
    if (d && mode === "live" && decisionId && (failed === "MONAD" || failed === "VERIFY" || failed === "SETTLEMENT")) {
      setSteps((prev) => {
        const next = { ...prev };
        for (const k of STEPS.slice(STEPS.indexOf(failed))) next[k] = { status: "pending" };
        if (failed === "MONAD") next.MONAD = { status: "active", note: "tekrar: cüzdanınızda onaylayın ya da keeper kullanın" };
        return next;
      });
      if (failed === "MONAD") return setRunning(false);
      return liveVerifyAndSettle(decisionId);
    }
    return start();
  }, [decisionId, liveVerifyAndSettle, mode, progress.decision, simExecution, simulateFrom, start, steps]);

  useEffect(() => () => void (cancelled.current = true), []);

  // Remember a finished round for the dashboard (this browser only).
  useEffect(() => {
    if (steps.SETTLEMENT.status === "done" && verify?.source !== "example") saveLastRound(chainView ?? roundView);
  }, [steps.SETTLEMENT.status, chainView, roundView, verify?.source]);

  const awaitingExecution = mode === "live" && !!decisionId && steps.MONAD.status === "active" && !running && steps.ACTION.status === "active";

  return {
    mode,
    setMode,
    steps,
    view: chainView ?? roundView,
    roundView,
    decision,
    txs,
    simExecution,
    verify,
    simSettlement,
    priceMissing,
    runExample,
    countdown,
    running,
    startedAt,
    parallelStartedAt,
    awaitingExecution,
    walletTx: walletTx.state,
    start,
    retry,
    executeLive,
  };
}
