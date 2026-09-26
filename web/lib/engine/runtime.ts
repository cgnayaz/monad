import "server-only";
import { getDecisionProvider } from "@/lib/ai";
import { ChainExecutionLayer } from "@/lib/chain/execution-layer";
import { deployment } from "@/lib/chain/deployments";
import { collectState } from "@/lib/collectors";
import { listAgents } from "@/lib/data/agents";
import { payloadStore } from "@/lib/store/payload-store";
import { latestPriceUpdate, priceUpdateAt } from "@/lib/collectors/pyth";
import { serverEnv } from "@/lib/config/server";
import { DEFAULT_PARAMS, ROUND_TIMING } from "@/lib/decmarkt/params";
import { AGENTS } from "@/lib/jev/agents";
import type { DecisionParameters } from "@/lib/model/final-decision";
import { FORKS, type AgentKey, type Hex } from "@/lib/types/protocol";
import type { PipelineDeps } from "./pipeline";
import type { ReputationRecords } from "./ports";

/**
 * Composition root for the decision pipeline: wires the real state collectors, the
 * configured AI provider and — when contracts and signers are available — the on-chain
 * execution layer. Nothing here fabricates a missing dependency; it reports it.
 */

export const DECISION_PARAMETERS: DecisionParameters = {
  submissionWindow: DEFAULT_PARAMS.submissionWindowSec,
  horizon: DEFAULT_PARAMS.horizonSec,
  bandBps: DEFAULT_PARAMS.bandBps,
  thresholdBps: DEFAULT_PARAMS.thresholdBps,
  minActionScore: DEFAULT_PARAMS.minActionScore,
  quorum: DEFAULT_PARAMS.quorum,
  allowedForks: [...FORKS],
  lockPerAgent: DEFAULT_PARAMS.lockPerAgent,
};

/** Parameters rounds run with: the defaults at the demo time scale (ROUND_TIMING). */
export const DEMO_PARAMETERS: DecisionParameters = {
  ...DECISION_PARAMETERS,
  submissionWindow: ROUND_TIMING.submissionWindowSec,
  horizon: ROUND_TIMING.horizonSec,
};

export function chainExecutionLayer(): { layer: ChainExecutionLayer } | { layer: null; reason: string } {
  const d = deployment();
  if (!d.deployed) return { layer: null, reason: "Contracts are not deployed; nothing is written on-chain" };
  const env = serverEnv();
  const agents = Object.fromEntries(AGENTS.map((a) => [a.key, env[a.operatorKeyEnv]])) as Record<AgentKey, Hex | undefined>;
  const missing = [
    ...(env.PROPOSER_PRIVATE_KEY ? [] : ["proposer"]),
    ...(env.KEEPER_PRIVATE_KEY ? [] : ["keeper"]),
    ...AGENTS.filter((a) => !agents[a.key]).map((a) => a.name),
  ];
  if (missing.length) return { layer: null, reason: `Signers not configured (${missing.join(", ")}); nothing is written on-chain` };
  return {
    layer: new ChainExecutionLayer(
      d.addresses,
      { proposer: env.PROPOSER_PRIVATE_KEY as Hex, keeper: env.KEEPER_PRIVATE_KEY as Hex, agents: agents as Record<AgentKey, Hex> },
      { latest: latestPriceUpdate, at: priceUpdateAt },
    ),
  };
}

export type PipelineSetup = { ok: true; deps: PipelineDeps } | { ok: false; reason: string };

export async function pipelineSetup(mode: "simulation" | "live" = "live"): Promise<PipelineSetup> {
  const provider = getDecisionProvider();
  if (provider.status !== "ok") return { ok: false, reason: provider.reason };

  const available = chainExecutionLayer();
  if (mode === "live" && !available.layer) return { ok: false, reason: `Live testnet mode unavailable: ${available.reason}` };
  const chain = mode === "live" ? available : { layer: null, reason: "Simulation mode: no transactions are sent" };
  let reputation: ReputationRecords = { source: "none-recorded", records: {} };
  if (chain.layer) {
    reputation = await chain.layer.reputation();
  } else if (available.layer || deployment().deployed) {
    const views = await listAgents();
    const records: ReputationRecords["records"] = {};
    for (const v of views) {
      if (v.onChain.status !== "ok") return { ok: false, reason: `Agent record unavailable: ${v.onChain.reason}` };
      records[v.spec.agentId] = { submitted: v.onChain.value.submitted, correct: v.onChain.value.correct };
    }
    reputation = { source: "chain", records };
  }

  return {
    ok: true,
    deps: {
      collectState,
      provider: provider.value,
      agents: AGENTS,
      params: DEMO_PARAMETERS,
      reputation,
      execution: chain.layer,
      simulationReason: chain.layer ? undefined : chain.reason,
      agentTimeoutMs: 60_000,
      payloads: payloadStore().store,
      executionPolicy: "defer",
    },
  };
}
