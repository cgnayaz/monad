import raw from "./deployments.10143.json";
import type { Address } from "@/lib/types/protocol";

/**
 * Contract addresses are written to deployments.10143.json by contracts/script/Deploy.s.sol.
 * Until then every address is null and the UI reports "not deployed".
 */

export const CONTRACT_NAMES = [
  "DecisionRegistry",
  "DecisionEngine",
  "ExecutionVault",
  "OutcomeRegistry",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

type DeploymentsFile = {
  chainId: number;
  deployBlock: number | null;
  contracts: Record<ContractName, string | null>;
};

const file = raw as DeploymentsFile;

const isAddress = (v: string | null): v is Address => !!v && /^0x[0-9a-fA-F]{40}$/.test(v);

export function contractAddress(name: ContractName): Address | null {
  const v = file.contracts[name];
  return isAddress(v) ? v : null;
}

export type Deployment =
  | { deployed: true; deployBlock: bigint; addresses: Record<ContractName, Address> }
  | { deployed: false; missing: ContractName[] };

export function deployment(): Deployment {
  const missing = CONTRACT_NAMES.filter((n) => !contractAddress(n));
  if (missing.length > 0 || file.deployBlock === null) return { deployed: false, missing: [...missing] };
  return {
    deployed: true,
    deployBlock: BigInt(file.deployBlock),
    addresses: Object.fromEntries(CONTRACT_NAMES.map((n) => [n, contractAddress(n)!])) as Record<
      ContractName,
      Address
    >,
  };
}
