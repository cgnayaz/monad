import "server-only";
import { contractAddress } from "@/lib/chain/deployments";
import { PYTH } from "@/lib/config/public";
import { DEFAULT_PARAMS, ROUND_TIMING } from "@/lib/decmarkt/params";
import { buildState, type StateRecord } from "@/lib/jev/state";
import { collectNetworkInputs } from "./network";
import { collectProtocolInputs } from "./protocol";
import { collectPythInputs } from "./pyth";

/**
 * REAL STATE → Jev STATE. Gathers every input from its source concurrently and builds
 * the hashed StateRecord. Missing sources become explicit `unavailable` inputs.
 */
export async function collectState(): Promise<StateRecord> {
  const now = Math.floor(Date.now() / 1000);
  const groups = await Promise.all([collectPythInputs(now), collectNetworkInputs(now), collectProtocolInputs(now)]);
  return buildState(
    {
      vault: contractAddress("ExecutionVault"),
      asset: "MON",
      referenceFeed: PYTH.feedSymbol,
      horizonSec: ROUND_TIMING.horizonSec, // the horizon rounds run with, as committed on chain
      bandBps: DEFAULT_PARAMS.bandBps,
    },
    groups.flat(),
    now,
  );
}
