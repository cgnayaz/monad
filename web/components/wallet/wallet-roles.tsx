"use client";

import { formatUnits, keccak256, toBytes, zeroHash } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { KeyValue, Panel } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { decisionEngineAbi, decisionRegistryAbi } from "@/lib/chain/abis";
import { contractAddress } from "@/lib/chain/deployments";
import { monadTestnet } from "@/lib/chain/monad";

const role = (name: string) => keccak256(toBytes(name));

/** The connected wallet as the contracts see it: balance and roles, read from the chain. */
export function WalletRoles() {
  const { address, chainId, isConnected } = useAccount();
  const registry = contractAddress("DecisionRegistry");
  const engine = contractAddress("DecisionEngine");
  const balance = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address } });
  const enabled = !!address && !!registry && !!engine;
  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled },
    contracts: enabled
      ? [
          { chainId: monadTestnet.id, address: registry, abi: decisionRegistryAbi, functionName: "hasRole", args: [zeroHash, address] },
          { chainId: monadTestnet.id, address: registry, abi: decisionRegistryAbi, functionName: "hasRole", args: [role("PROPOSER_ROLE"), address] },
          { chainId: monadTestnet.id, address: engine, abi: decisionEngineAbi, functionName: "hasRole", args: [role("GUARDIAN_ROLE"), address] },
          { chainId: monadTestnet.id, address: registry, abi: decisionRegistryAbi, functionName: "agentIdOf", args: [address] },
        ]
      : [],
  });

  if (!isConnected || !address) {
    return (
      <Panel title="Your wallet">
        <p className="px-4 py-3 text-[13px] text-ink-2">Connect a wallet to see its balance and its roles in the DecMarkt contracts.</p>
      </Panel>
    );
  }
  const flag = (i: number) => {
    const r = reads.data?.[i];
    if (!enabled) return <span className="text-ink-3">contracts not deployed</span>;
    if (!r || reads.isLoading) return <span className="text-ink-3">reading…</span>;
    if (r.status === "failure") return <span className="text-fail">read failed</span>;
    return <StatusMark tone={r.result ? "pass" : "neutral"}>{r.result ? "yes" : "no"}</StatusMark>;
  };
  const agent = reads.data?.[3];
  return (
    <Panel title="Your wallet">
      <KeyValue
        rows={[
          { k: "Address", v: <span className="break-all font-mono text-[12.5px]">{address}</span> },
          { k: "Network", v: chainId === monadTestnet.id ? <StatusMark tone="pass">Monad Testnet</StatusMark> : <StatusMark tone="wait">wrong network ({chainId})</StatusMark> },
          { k: "Balance", v: balance.data ? <span className="font-mono">{Number(formatUnits(balance.data.value, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} MON</span> : balance.isError ? <span className="text-fail">RPC unavailable</span> : "reading…" },
          { k: "Admin", v: flag(0) },
          { k: "Proposer", v: flag(1) },
          { k: "Guardian", v: flag(2) },
          {
            k: "Agent operator",
            v:
              agent?.status === "success" ? (
                (agent.result as readonly [boolean, number])[0] ? <span className="font-mono">agent {(agent.result as readonly [boolean, number])[1]}</span> : <StatusMark tone="neutral">no</StatusMark>
              ) : (
                flag(3)
              ),
          },
        ]}
      />
    </Panel>
  );
}
