"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { ACTION_LABEL, type WalletAction } from "@/lib/chain/wallet-actions";
import { formatUtc } from "@/lib/format";
import { FORKS, type Status } from "@/lib/types/protocol";
import { TxLifecycle } from "./tx-lifecycle";
import { useWalletTx } from "./use-wallet-tx";

export interface LifecycleContext {
  decisionId: string;
  status: Status;
  deadline: number | null;
  finalsSubmitted: number;
  participants: number;
  guardianRequired: boolean;
  guardianDeadline: number | null;
  allowedForks: number;
  executedAt: number | null;
  horizon: number;
}

/**
 * The next lifecycle step of a decision, as a wallet transaction. Which step is offered is
 * derived from on-chain state; the wallet only chooses whether to send it (and, as a
 * guardian, which of the three bounded forks). The contract enforces every rule again.
 */
export function LifecycleActions({ ctx }: { ctx: LifecycleContext }) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const tx = useWalletTx();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const id = ctx.decisionId;
  const t0 = ctx.executedAt !== null ? ctx.executedAt + ctx.horizon : null;
  let offer: { actions: { action: WalletAction; label: string }[]; waitUntil: number | null; why: string } | null = null;

  switch (ctx.status) {
    case "OPEN":
      offer = {
        actions: [{ action: { kind: "aggregate", decisionId: id }, label: "Aggregate" }],
        waitUntil: ctx.finalsSubmitted >= ctx.participants || ctx.deadline === null ? null : ctx.deadline + 1,
        why: "Aggregation is permissionless once the submission window closes or everyone has submitted.",
      };
      break;
    case "AGGREGATED":
      offer =
        ctx.guardianRequired && ctx.guardianDeadline !== null && now <= ctx.guardianDeadline
          ? {
              actions: FORKS.slice(0, 3)
                .map((f, i) => ({ f, i }))
                .filter(({ i }) => (ctx.allowedForks & (1 << i)) !== 0)
                .map(({ f, i }) => ({ action: { kind: "guardianDecide", decisionId: id, choice: i as 0 | 1 | 2 }, label: `Guardian: ${f}` })),
              waitUntil: null,
              why: `Agents escalated. Only a wallet holding GUARDIAN_ROLE can choose, until ${ctx.guardianDeadline ? formatUtc(ctx.guardianDeadline) : "—"}.`,
            }
          : {
              actions: [{ action: { kind: "finalizeEscalation", decisionId: id }, label: "Finalize escalation (NO_ACTION)" }],
              waitUntil: ctx.guardianDeadline !== null ? ctx.guardianDeadline + 1 : null,
              why: "The guardian window has closed; anyone can finalize the escalation as NO_ACTION.",
            };
      break;
    case "APPROVED":
      offer = {
        actions: [{ action: { kind: "execute", decisionId: id }, label: "Execute approved action" }],
        waitUntil: null,
        why: "Anyone may execute; the vault runs only the approved branch. The wallet pays the Pyth fee.",
      };
      break;
    case "EXECUTED":
      offer = {
        actions: [{ action: { kind: "resolve", decisionId: id }, label: "Verify outcome" }],
        waitUntil: t0 !== null ? t0 + 1 : null,
        why: "After the horizon, a signed Pyth price published inside the window settles the decision.",
      };
      break;
  }

  if (!offer) return <p className="text-[13px] text-ink-2">No further lifecycle step: the decision is {ctx.status.toLowerCase()}.</p>;
  const wait = offer.waitUntil !== null && now < offer.waitUntil ? offer.waitUntil - now : 0;
  const busy = tx.state.phase !== "idle" && tx.state.phase !== "confirmed" && tx.state.phase !== "failed";

  const send = async (a: WalletAction) => {
    const r = await tx.run(a, { resolveAt: t0 !== null ? t0 + 1 : undefined });
    if (r) router.refresh(); // re-read the decision from chain
  };

  return (
    <div className="space-y-3">
      <div className="border border-rule bg-surface px-4 py-3">
        <p className="text-[13px]">
          Next step: <span className="font-mono">{offer.actions.map((a) => ACTION_LABEL[a.action.kind]).filter((v, i, arr) => arr.indexOf(v) === i).join(" / ")}</span>
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-2">{offer.why}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {offer.actions.map((a) => (
            <Button key={a.label} variant={offer.actions.length > 1 ? "secondary" : "primary"} disabled={!isConnected || wait > 0 || busy} onClick={() => send(a.action)}>
              {a.label}
            </Button>
          ))}
          {!isConnected && <span className="text-[12.5px] text-ink-3">Connect a wallet (top right) to send it.</span>}
          {wait > 0 && <span className="font-mono text-[12.5px] text-ink-2">available in {wait} s</span>}
        </div>
      </div>
      <TxLifecycle state={tx.state} />
    </div>
  );
}
