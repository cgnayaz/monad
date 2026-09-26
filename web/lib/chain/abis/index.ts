import { parseAbi } from "viem";

/**
 * Contract ABIs. The four DecMarkt ABIs are generated from the Foundry artifacts
 * (`node scripts/sync-abis.mjs` after `forge build`), so they always match the deployed
 * bytecode. Enum values are uint8 in the order of lib/types/protocol.ts.
 */
export { decisionEngineAbi, decisionRegistryAbi, executionVaultAbi, outcomeRegistryAbi } from "./generated";

export const pythAbi = parseAbi([
  "function version() pure returns (string)",
  "function getValidTimePeriod() view returns (uint256)",
]);
