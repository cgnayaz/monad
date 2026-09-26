"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { monadTestnet } from "@/lib/chain/monad";
import { shortHex } from "@/lib/format";

/** Guardian wallet connection. Agents never use a browser wallet. */
export function WalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const base = "h-8 rounded-xs border px-3 text-[12px] font-medium transition-colors";

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        type="button"
        className={`${base} border-rule text-ink hover:border-ink disabled:text-ink-3`}
        disabled={!injected || isPending}
        onClick={() => injected && connect({ connector: injected, chainId: monadTestnet.id })}
      >
        {isPending ? "Connecting" : "Connect wallet"}
      </button>
    );
  }
  if (chainId !== monadTestnet.id) {
    return (
      <button type="button" className={`${base} border-wait text-wait`} onClick={() => switchChain({ chainId: monadTestnet.id })}>
        Switch to Monad
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`${base} border-rule font-mono text-ink-2 hover:border-ink`}
      title="Disconnect"
      onClick={() => disconnect()}
    >
      {shortHex(address ?? "0x")}
    </button>
  );
}
