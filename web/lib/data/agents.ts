import "server-only";
import { decisionRegistryAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { deployment } from "@/lib/chain/deployments";
import { AGENTS, type AgentSpec } from "@/lib/jev/agents";
import { ok, unavailable, type Address, type Availability } from "@/lib/types/protocol";
import { publicError } from "@/lib/server/public-error";

export interface AgentOnChain {
  operator: Address;
  active: boolean;
  bond: bigint;
  locked: bigint;
  submitted: number;
  correct: number;
  missed: number;
}

export interface AgentView {
  spec: AgentSpec;
  onChain: Availability<AgentOnChain>;
}

export async function listAgents(): Promise<AgentView[]> {
  const d = deployment();
  if (!d.deployed) {
    return AGENTS.map((spec) => ({ spec, onChain: unavailable("Contracts not deployed; no on-chain identity yet") }));
  }
  return Promise.all(
    AGENTS.map(async (spec): Promise<AgentView> => {
      try {
        const a = await publicClient.readContract({
          address: d.addresses.DecisionRegistry,
          abi: decisionRegistryAbi,
          functionName: "getAgent",
          args: [spec.agentId],
        });
        return {
          spec,
          onChain: ok({
            operator: a.operator,
            active: a.active,
            bond: a.bond,
            locked: a.locked,
            submitted: a.submitted,
            correct: a.correct,
            missed: a.missed,
          }),
        };
      } catch (err) {
        return { spec, onChain: unavailable(publicError(err, "read failed")) };
      }
    }),
  );
}
