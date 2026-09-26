import { createPublicClient, http } from "viem";
import { monadTestnet } from "./monad";

/** Read-only client. Safe on server and client. Writes live in the server-side orchestrator. */
export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(undefined, { timeout: 8_000, retryCount: 1 }),
});
