import "server-only";
import { decisionRegistryAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { deployment } from "@/lib/chain/deployments";
import { signerAddresses } from "@/lib/chain/signers";
import { AGENTS } from "@/lib/jev/agents";
import type { AgentKey } from "@/lib/types/protocol";

export interface AgentIdResolution {
  /** On-chain agent id per role: the id registered for the configured operator, else the original id. */
  ids: Record<AgentKey, number>;
  /** Roles whose configured operator address is registered on chain. */
  registered: Record<AgentKey, boolean>;
}

let cache: { at: number; value: AgentIdResolution } | null = null;

/**
 * Resolve each agent role to the id its configured operator holds in DecisionRegistry
 * (agentIdOf). Re-registered operators get new ids (5–9 after the original 0–4); roles
 * keep their order, so `id % 5` always maps back to the role for display.
 */
export async function resolveAgentIds(): Promise<AgentIdResolution> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const d = deployment();
  const addrs = signerAddresses().agents;
  const ids = Object.fromEntries(AGENTS.map((a) => [a.key, a.agentId])) as Record<AgentKey, number>;
  const registered = Object.fromEntries(AGENTS.map((a) => [a.key, false])) as Record<AgentKey, boolean>;
  if (d.deployed) {
    await Promise.all(
      AGENTS.map(async (a) => {
        const addr = addrs[a.key];
        if (!addr) return;
        try {
          const [ok, id] = await publicClient.readContract({ address: d.addresses.DecisionRegistry, abi: decisionRegistryAbi, functionName: "agentIdOf", args: [addr] });
          if (ok) {
            ids[a.key] = Number(id);
            registered[a.key] = true;
          }
        } catch {
          /* unreadable: keep the original id; readiness reports the role as not registered */
        }
      }),
    );
  }
  const value = { ids, registered };
  cache = { at: Date.now(), value };
  return value;
}

export function clearAgentIdCache() {
  cache = null;
}
