import "server-only";
import { createWalletClient, http, keccak256, parseEther, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decisionRegistryAbi } from "@/lib/chain/abis";
import { clearAgentIdCache, resolveAgentIds } from "@/lib/chain/agent-ids";
import { publicClient } from "@/lib/chain/client";
import { deployment } from "@/lib/chain/deployments";
import { monadTestnet } from "@/lib/chain/monad";
import { signerAddresses, signerKeys } from "@/lib/chain/signers";
import { AGENTS } from "@/lib/jev/agents";
import type { Address, AgentKey } from "@/lib/types/protocol";

/** Funding targets for the live-mode signers (test MON). */
export const TARGETS = { agentBond: parseEther("0.2"), agentGas: parseEther("0.05"), keeperGas: parseEther("0.1") } as const;
/** What the admin sends the proposer once; it covers bonds, gas top-ups and its own transactions. */
export const PROPOSER_FUNDING = parseEther("2");

export const PROPOSER_ROLE = keccak256(stringToBytes("PROPOSER_ROLE"));

export interface SetupStatus {
  configured: boolean;
  derived: boolean;
  registry: Address | null;
  agentCount: number | null;
  proposer: { address: Address; hasRole: boolean; balance: string } | null;
  keeper: { address: Address; balance: string } | null;
  agents: { key: AgentKey; name: string; index: number; address: Address; registered: boolean; agentId: number | null; bond: string | null; balance: string }[];
}

/** Everything the /kurulum page needs, read from chain. Addresses only; keys never leave the server. */
export async function setupStatus(): Promise<SetupStatus> {
  const d = deployment();
  const addrs = signerAddresses();
  const configured = !!addrs.proposer && !!addrs.keeper && AGENTS.every((a) => !!addrs.agents[a.key]);
  const base: SetupStatus = { configured, derived: signerKeys().derived, registry: d.deployed ? d.addresses.DecisionRegistry : null, agentCount: null, proposer: null, keeper: null, agents: [] };
  if (!configured || !d.deployed) return base;
  clearAgentIdCache();
  const reg = d.addresses.DecisionRegistry;
  const bal = async (a: Address) => String(await publicClient.getBalance({ address: a }));
  const [agentCount, hasRole, pBal, kBal, ids] = await Promise.all([
    publicClient.readContract({ address: reg, abi: decisionRegistryAbi, functionName: "agentCount" }),
    publicClient.readContract({ address: reg, abi: decisionRegistryAbi, functionName: "hasRole", args: [PROPOSER_ROLE, addrs.proposer!] }),
    bal(addrs.proposer!),
    bal(addrs.keeper!),
    resolveAgentIds(),
  ]);
  const agents = await Promise.all(
    AGENTS.map(async (a, index) => {
      const address = addrs.agents[a.key]!;
      const registered = ids.registered[a.key];
      const bond = registered ? String((await publicClient.readContract({ address: reg, abi: decisionRegistryAbi, functionName: "getAgent", args: [ids.ids[a.key]] })).bond) : null;
      return { key: a.key, name: a.name, index, address, registered, agentId: registered ? ids.ids[a.key] : null, bond, balance: await bal(address) };
    }),
  );
  return { ...base, agentCount: Number(agentCount), proposer: { address: addrs.proposer!, hasRole, balance: pBal }, keeper: { address: addrs.keeper!, balance: kBal }, agents };
}

/**
 * From the proposer's balance: deposit each registered agent's bond up to the target and top up
 * the keeper's and agents' gas. Idempotent: only shortfalls are sent.
 */
export async function distributeFunds(): Promise<{ label: string; hash: Hex }[]> {
  const d = deployment();
  if (!d.deployed) throw new Error("Kontratlar dağıtılmamış");
  const keys = signerKeys();
  if (!keys.proposer || !keys.keeper) throw new Error("İmzacı anahtarları yok (SIGNER_SEED)");
  const s = await setupStatus();
  const account = privateKeyToAccount(keys.proposer);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(monadTestnet.rpcUrls.default.http[0]) });
  const done: { label: string; hash: Hex }[] = [];
  const confirm = async (label: string, hash: Hex) => {
    const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`${label} işlemi başarısız oldu (${hash})`);
    done.push({ label, hash });
  };
  for (const a of s.agents) {
    if (a.registered && a.agentId !== null && BigInt(a.bond ?? "0") < TARGETS.agentBond) {
      const value = TARGETS.agentBond - BigInt(a.bond ?? "0");
      await confirm(`${a.name} teminatı`, await wallet.writeContract({ address: d.addresses.DecisionRegistry, abi: decisionRegistryAbi, functionName: "depositBond", args: [a.agentId], value }));
    }
    if (BigInt(a.balance) < TARGETS.agentGas) {
      await confirm(`${a.name} gas`, await wallet.sendTransaction({ to: a.address, value: TARGETS.agentGas - BigInt(a.balance) }));
    }
  }
  if (s.keeper && BigInt(s.keeper.balance) < TARGETS.keeperGas) {
    await confirm("Keeper gas", await wallet.sendTransaction({ to: s.keeper.address, value: TARGETS.keeperGas - BigInt(s.keeper.balance) }));
  }
  clearAgentIdCache();
  return done;
}
