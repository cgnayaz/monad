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
      <Panel title="Cüzdanınız">
        <p className="px-4 py-3 text-[13px] text-ink-2">Bakiyesini ve DecMarkt kontratlarındaki rollerini görmek için bir cüzdan bağlayın.</p>
      </Panel>
    );
  }
  const flag = (i: number) => {
    const r = reads.data?.[i];
    if (!enabled) return <span className="text-ink-3">kontratlar dağıtılmamış</span>;
    if (!r || reads.isLoading) return <span className="text-ink-3">okunuyor…</span>;
    if (r.status === "failure") return <span className="text-fail">okuma başarısız</span>;
    return <StatusMark tone={r.result ? "pass" : "neutral"}>{r.result ? "evet" : "hayır"}</StatusMark>;
  };
  const agent = reads.data?.[3];
  return (
    <Panel title="Cüzdanınız">
      <KeyValue
        rows={[
          { k: "Adres", v: <span className="break-all font-mono text-[12.5px]">{address}</span> },
          { k: "Ağ", v: chainId === monadTestnet.id ? <StatusMark tone="pass">Monad Testnet</StatusMark> : <StatusMark tone="wait">yanlış ağ ({chainId})</StatusMark> },
          { k: "Bakiye", v: balance.data ? <span className="font-mono">{Number(formatUnits(balance.data.value, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} MON</span> : balance.isError ? <span className="text-fail">RPC kullanılamıyor</span> : "okunuyor…" },
          { k: <span lang="en">Admin</span>, v: flag(0) },
          { k: <span lang="en">Proposer</span>, v: flag(1) },
          { k: <span lang="en">Guardian</span>, v: flag(2) },
          {
            k: "Ajan operatörü",
            v:
              agent?.status === "success" ? (
                (agent.result as readonly [boolean, number])[0] ? <span className="font-mono">ajan {(agent.result as readonly [boolean, number])[1]}</span> : <StatusMark tone="neutral">hayır</StatusMark>
              ) : (
                flag(3)
              ),
          },
        ]}
      />
    </Panel>
  );
}
