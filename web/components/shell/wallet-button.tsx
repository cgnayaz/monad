"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { StatusMark } from "@/components/ui/status";
import { explorer, monadTestnet } from "@/lib/chain/monad";
import { classifyTxError } from "@/lib/chain/tx-errors";
import { shortHex } from "@/lib/format";

const base = "h-8 rounded-xs border px-3 text-[12px] font-medium transition-colors";

/**
 * Wallet connection: connect, network detection and switching, address, live MON balance,
 * disconnect. Balances and chain id are read from the wallet and the Monad RPC — never
 * assumed. The browser wallet is used for predefined lifecycle calls only.
 */
export function WalletButton() {
  const { address, chainId, isConnected, connector } = useAccount();
  const { connect, connectors, isPending, error: connectError, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const balance = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address, refetchInterval: 12_000 } });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!isConnected || !address) {
    // Prefer MetaMask when it announces itself (EIP-6963); otherwise the generic injected provider.
    const injected = connectors.find((c) => c.id === "io.metamask") ?? connectors[0];
    const err = connectError ? classifyTxError(connectError) : null;
    return (
      <div className="relative">
        <button
          type="button"
          className={`${base} border-rule text-ink hover:border-ink disabled:text-ink-3`}
          disabled={!injected || isPending}
          onClick={() => {
            resetConnect();
            if (injected) connect({ connector: injected, chainId: monadTestnet.id });
          }}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {err && (
          <p role="alert" className="absolute right-0 top-10 z-20 w-64 border border-fail bg-surface px-3 py-2 text-[12px] text-fail">
            {err.kind === "rejected" ? "Connection rejected in the wallet." : err.message}
          </p>
        )}
      </div>
    );
  }

  const wrongNetwork = chainId !== monadTestnet.id;
  const mon = balance.data ? Number(formatUnits(balance.data.value, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${base} inline-flex items-center gap-2 font-mono ${wrongNetwork ? "border-wait text-wait" : "border-rule text-ink-2 hover:border-ink"}`}
      >
        <span aria-hidden className={`inline-block h-1.5 w-1.5 ${wrongNetwork ? "bg-wait" : "bg-pass"}`} />
        {wrongNetwork ? "Wrong network" : shortHex(address, 4, 4)}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-30 w-[300px] border border-rule bg-surface text-[12.5px] shadow-[0_1px_0_var(--rule)]">
          <dl className="divide-y divide-rule">
            <div className="px-4 py-2.5">
              <dt className="label">Address</dt>
              <dd className="mt-0.5 break-all font-mono">
                <a href={explorer.address(address)} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:decoration-ink">
                  {address}
                </a>
              </dd>
            </div>
            <div className="px-4 py-2.5">
              <dt className="label">Network</dt>
              <dd className="mt-0.5 flex items-center justify-between gap-2">
                {wrongNetwork ? <StatusMark tone="wait">chain {chainId ?? "unknown"}</StatusMark> : <StatusMark tone="pass">Monad Testnet · {monadTestnet.id}</StatusMark>}
                {wrongNetwork && (
                  <button type="button" onClick={() => switchChain({ chainId: monadTestnet.id })} disabled={switching} className="text-[12px] text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
                    {switching ? "Switching…" : "Switch"}
                  </button>
                )}
              </dd>
              {switchError && <p className="mt-1 text-[11.5px] text-fail">{classifyTxError(switchError).message}</p>}
            </div>
            <div className="px-4 py-2.5">
              <dt className="label">Balance</dt>
              <dd className="mt-0.5 font-mono">
                {balance.isError ? <span className="text-fail">RPC unavailable</span> : mon === null ? <span className="text-ink-3">reading…</span> : `${mon} MON`}
              </dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-ink-3">{connector?.name ?? "wallet"}</span>
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="text-[12px] text-ink underline decoration-rule underline-offset-2 hover:decoration-ink"
              >
                Disconnect
              </button>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
