"use client";

import { StatusMark } from "@/components/ui/status";
import { explorer } from "@/lib/chain/monad";
import type { TxErrorKind } from "@/lib/chain/tx-errors";
import type { TxPhase, TxState } from "./use-wallet-tx";

const PHASES: { key: Exclude<TxPhase, "idle" | "failed">; label: string }[] = [
  { key: "preparing", label: "Preparing" },
  { key: "awaiting-approval", label: "Awaiting approval" },
  { key: "submitted", label: "Submitted" },
  { key: "confirming", label: "Confirming" },
  { key: "confirmed", label: "Confirmed" },
];

const ERROR_LABEL: Record<TxErrorKind, string> = {
  "no-wallet": "No wallet",
  rejected: "Rejected",
  "wrong-network": "Wrong network",
  "insufficient-balance": "Insufficient balance",
  rpc: "RPC failure",
  revert: "Contract revert",
  unknown: "Error",
};

/** The real lifecycle of one wallet transaction, with its hash, explorer link and receipt. */
export function TxLifecycle({ state }: { state: TxState }) {
  if (state.phase === "idle") return null;
  const failed = state.phase === "failed";
  // Where the failure happened: the last phase that had been reached.
  const reached = failed ? (state.receipt ? 3 : state.hash ? 2 : state.error?.kind === "rejected" ? 1 : 0) : PHASES.findIndex((p) => p.key === state.phase);

  return (
    <div className="border border-rule bg-surface" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[12.5px]">{state.label}</span>
        {failed ? (
          <StatusMark tone="fail">{state.error ? ERROR_LABEL[state.error.kind] : "failed"}</StatusMark>
        ) : (
          <StatusMark tone={state.phase === "confirmed" ? "pass" : "wait"} live={state.phase !== "confirmed"}>
            {PHASES[reached]?.label ?? state.phase}
          </StatusMark>
        )}
      </div>
      <ol className="grid grid-cols-5 border-b border-rule">
        {PHASES.map((p, i) => {
          const done = !failed ? i < reached || state.phase === "confirmed" : i < reached;
          const current = i === reached;
          return (
            <li key={p.key} className={`relative px-2 py-2 text-center text-[10.5px] font-medium uppercase tracking-[0.05em] sm:text-[11px] ${i < 4 ? "border-r border-rule" : ""}`}>
              <span
                aria-hidden
                className={`absolute inset-x-0 top-0 h-0.5 ${current && failed ? "bg-fail" : done ? "bg-ink" : current ? "bg-accent" : "bg-transparent"}`}
              />
              <span className={current && failed ? "text-fail" : done ? "text-ink" : current ? "text-accent" : "text-ink-3"}>{p.label}</span>
            </li>
          );
        })}
      </ol>
      <dl className="space-y-1 px-4 py-2.5 text-[12.5px]">
        {state.note && !failed && <p className="text-ink-2">{state.note}</p>}
        {state.hash && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-3">Transaction</dt>
            <dd>
              <a href={explorer.tx(state.hash)} target="_blank" rel="noreferrer" className="break-all font-mono underline decoration-rule underline-offset-2 hover:decoration-ink">
                {state.hash}
              </a>
            </dd>
          </div>
        )}
        {state.receipt && (
          <div className="flex flex-wrap gap-x-4 font-mono text-[12px] text-ink-2">
            <span>
              block{" "}
              <a href={explorer.block(BigInt(state.receipt.blockNumber))} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                {state.receipt.blockNumber}
              </a>
            </span>
            <span>gas used {Number(state.receipt.gasUsed).toLocaleString("en-US")}</span>
            <span>status {state.receipt.status}</span>
          </div>
        )}
        {failed && state.error && (
          <div className="text-fail">
            <p>{state.error.message}</p>
            {state.error.detail && state.error.detail !== state.error.message && <p className="mt-0.5 break-words font-mono text-[11.5px] text-ink-2">{state.error.detail}</p>}
          </div>
        )}
      </dl>
    </div>
  );
}
