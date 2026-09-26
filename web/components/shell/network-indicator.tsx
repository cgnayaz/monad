"use client";

import { useBlockNumber } from "wagmi";
import { monadTestnet } from "@/lib/chain/monad";

/** Live block height from Monad Testnet RPC. Shows an explicit state when unreachable. */
export function NetworkIndicator() {
  const { data, isError, isPending } = useBlockNumber({ chainId: monadTestnet.id, watch: { pollingInterval: 4_000 } });
  const state = isError ? "fail" : isPending ? "wait" : "pass";
  return (
    <div className="hidden items-center gap-2 font-mono text-[12px] text-ink-2 sm:flex" title="Son Monad Testnet bloğu">
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 ${state === "pass" ? "bg-pass" : state === "fail" ? "bg-fail" : "bg-wait"}`}
      />
      <span className="tabular">
        {isError ? "RPC erişilemiyor" : isPending ? "bağlanıyor" : `#${data?.toLocaleString("en-US")}`}
      </span>
    </div>
  );
}
