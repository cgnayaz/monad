import { createPublicClient, http } from "viem";
import { isLocalRpc, monadTestnet } from "./monad";

/**
 * Read-only client. Safe on server and client. Writes live in the server-side orchestrator.
 * Parallel reads (a decision page issues dozens) are batched into one Multicall3 call on
 * Monad Testnet; a local anvil chain has no Multicall3, so reads go one by one there.
 */
export const publicClient = createPublicClient({
  chain: monadTestnet,
  batch: isLocalRpc ? undefined : { multicall: { wait: 16 } },
  transport: http(undefined, { timeout: 8_000, retryCount: 1 }),
});
