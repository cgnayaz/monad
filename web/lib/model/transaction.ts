import type { ContractName } from "@/lib/chain/deployments";
import type { Hex, Status } from "@/lib/types/protocol";

/** A transaction as observed on Monad. Hashes and blocks come only from the chain. */
export interface TxRef {
  chainId: number;
  hash: Hex;
  blockNumber: bigint;
  contract: ContractName;
  functionName: string;
}

export interface LifecycleTransition {
  status: Status;
  blockNumber: bigint;
  /** null if the log could not be read; the block is still known from contract storage. */
  tx: TxRef | null;
}
