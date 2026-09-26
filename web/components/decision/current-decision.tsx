"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, StatusMark } from "@/components/ui/status";
import { formatUtc } from "@/lib/format";
import type { DecisionView } from "@/lib/view/decision-view";
import { parseStoredRound, readLastRoundRaw, subscribeLastRound } from "@/lib/view/last-round";
import { DecisionBoard } from "./decision-board";

/**
 * The dashboard's current decision: the latest on-chain decision when one exists;
 * otherwise the last round run from this browser (clearly labelled); otherwise nothing.
 */
export function CurrentDecision({ chain, chainNote }: { chain: DecisionView | null; chainNote: string }) {
  const raw = useSyncExternalStore(subscribeLastRound, readLastRoundRaw, () => null);
  const stored = useMemo(() => (chain ? null : parseStoredRound(raw)), [chain, raw]);

  if (chain) {
    return (
      <DecisionBoard
        v={chain}
        header={
          <Header
            title={`Decision #${chain.decisionId}`}
            meta={
              <>
                <StatusMark tone={chain.status === "RESOLVED" ? "pass" : chain.status === "CANCELLED" ? "fail" : "wait"}>{chain.status}</StatusMark>
                <span>on-chain · created {chain.createdAt ? formatUtc(chain.createdAt) : "—"}</span>
              </>
            }
            link={{ href: `/decisions/${chain.decisionId}`, label: "Full audit record" }}
          />
        }
      />
    );
  }
  if (stored) {
    const v = stored.view;
    return (
      <DecisionBoard
        v={v}
        header={
          <Header
            title={v.mode === "live" && v.decisionId ? `Decision #${v.decisionId}` : "Simulation round"}
            meta={
              <>
                <StatusMark tone={v.mode === "live" ? "accent" : "neutral"}>{v.mode}</StatusMark>
                <span>run from this browser · {formatUtc(Math.floor(stored.savedAt / 1000))}</span>
                {v.mode === "simulation" && <span className="text-ink-3">not committed on-chain</span>}
              </>
            }
            link={v.mode === "live" && v.decisionId ? { href: `/decisions/${v.decisionId}`, label: "Full audit record" } : { href: "/demo", label: "Run another round" }}
          />
        }
      />
    );
  }
  return (
    <EmptyState title="No decision yet" action={<LinkButton href="/demo" variant="primary">Run a round</LinkButton>}>
      <p>{chainNote}</p>
      <p className="mt-2">
        A round snapshots the current state below, asks the five analysts its questions in parallel, and applies the deterministic rules. The result
        appears here.
      </p>
    </EmptyState>
  );
}

function Header({ title, meta, link }: { title: string; meta: React.ReactNode; link: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <h2 className="text-[20px] font-medium leading-7">{title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">{meta}</div>
      </div>
      <Link href={link.href} className="text-[13px] text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink">
        {link.label} →
      </Link>
    </div>
  );
}
