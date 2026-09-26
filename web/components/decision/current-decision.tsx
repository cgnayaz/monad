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
            title={`Karar #${chain.decisionId}`}
            meta={
              <>
                <StatusMark tone={chain.status === "RESOLVED" ? "pass" : chain.status === "CANCELLED" ? "fail" : "wait"}>{chain.status}</StatusMark>
                <span>zincir üstü · oluşturulma {chain.createdAt ? formatUtc(chain.createdAt) : "—"}</span>
              </>
            }
            link={{ href: `/decisions/${chain.decisionId}`, label: "Tam denetim kaydı" }}
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
            title={v.mode === "live" && v.decisionId ? `Karar #${v.decisionId}` : "Simülasyon turu"}
            meta={
              <>
                <StatusMark tone={v.mode === "live" ? "accent" : "neutral"}>{v.mode === "live" ? "canlı" : "simülasyon"}</StatusMark>
                <span>bu tarayıcıdan çalıştırıldı · {formatUtc(Math.floor(stored.savedAt / 1000))}</span>
                {v.mode === "simulation" && <span className="text-ink-3">zincire işlenmedi</span>}
              </>
            }
            link={v.mode === "live" && v.decisionId ? { href: `/decisions/${v.decisionId}`, label: "Tam denetim kaydı" } : { href: "/demo", label: "Yeni bir tur çalıştır" }}
          />
        }
      />
    );
  }
  return (
    <EmptyState title="Henüz karar yok" action={<LinkButton href="/demo" variant="primary">Tur çalıştır</LinkButton>}>
      <p>{chainNote}</p>
      <p className="mt-2">
        Bir tur aşağıdaki güncel durumun anlık görüntüsünü alır, beş analiste sorularını paralel olarak sorar ve deterministik kuralları uygular.
        Sonuç burada görünür.
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
