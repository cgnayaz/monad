import "server-only";
import { pythAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { CONTRACT_NAMES, contractAddress, type ContractName } from "@/lib/chain/deployments";
import { PYTH } from "@/lib/config/public";
import { ok, unavailable, type Address, type Availability } from "@/lib/types/protocol";

export const CONTRACT_ROLES: Record<ContractName, string> = {
  DecisionRegistry: "Agents, bonds, reward pool, decision records, lifecycle status, submissions",
  DecisionEngine: "Deterministic aggregation, threshold, approval, guardian escalation",
  ExecutionVault: "Treasury MON, ACTIVE/RESERVE buckets, bounded actions, start price",
  OutcomeRegistry: "Pyth-verified outcome, correct fork, settlement computation",
};

export interface ContractStatus {
  name: ContractName;
  role: string;
  address: Address | null;
  code: Availability<{ bytes: number }>;
}

async function codeSize(address: Address): Promise<Availability<{ bytes: number }>> {
  try {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") return unavailable("No bytecode at address");
    return ok({ bytes: (code.length - 2) / 2 });
  } catch (err) {
    return unavailable(err instanceof Error ? err.message.split("\n")[0] : "RPC read failed");
  }
}

export async function listContracts(): Promise<ContractStatus[]> {
  return Promise.all(
    CONTRACT_NAMES.map(async (name) => {
      const address = contractAddress(name);
      return {
        name,
        role: CONTRACT_ROLES[name],
        address,
        code: address ? await codeSize(address) : unavailable("Not deployed"),
      };
    }),
  );
}

export interface PythStatus {
  address: Address;
  version: Availability<string>;
  validTimePeriod: Availability<number>;
}

export async function pythStatus(): Promise<PythStatus> {
  const address = PYTH.contract;
  const [version, period] = await Promise.allSettled([
    publicClient.readContract({ address, abi: pythAbi, functionName: "version" }),
    publicClient.readContract({ address, abi: pythAbi, functionName: "getValidTimePeriod" }),
  ]);
  return {
    address,
    version: version.status === "fulfilled" ? ok(version.value) : unavailable("RPC read failed"),
    validTimePeriod: period.status === "fulfilled" ? ok(Number(period.value)) : unavailable("RPC read failed"),
  };
}
