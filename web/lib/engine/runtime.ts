import "server-only";
import { getDecisionProvider } from "@/lib/ai";
import { ChainExecutionLayer } from "@/lib/chain/execution-layer";
import { deployment } from "@/lib/chain/deployments";
import { collectState } from "@/lib/collectors";
import { listAgents } from "@/lib/data/agents";
import { payloadStore } from "@/lib/store/payload-store";
import { latestPriceUpdate, priceUpdateAt } from "@/lib/collectors/pyth";
import { resolveAgentIds } from "@/lib/chain/agent-ids";
import { signerKeys } from "@/lib/chain/signers";
import { DEFAULT_PARAMS, ROUND_TIMING } from "@/lib/decmarkt/params";
import { AGENTS } from "@/lib/jev/agents";
import type { DecisionParameters } from "@/lib/model/final-decision";
import { FORKS, type AgentKey, type Hex } from "@/lib/types/protocol";
import type { AgentSpec } from "@/lib/jev/agents";
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
  if (!d.deployed) return { layer: null, reason: "Kontratlar dağıtılmamış; zincire hiçbir şey yazılmaz" };
  const keys = signerKeys();
  const agents = keys.agents;
  const missing = [
    ...(keys.proposer ? [] : ["proposer"]),
    ...(keys.keeper ? [] : ["keeper"]),
    ...AGENTS.filter((a) => !agents[a.key]).map((a) => a.name),
  ];
  if (missing.length) return { layer: null, reason: `İmzacılar yapılandırılmamış (${missing.join(", ")}); zincire hiçbir şey yazılmaz` };
  return {
    layer: new ChainExecutionLayer(
      d.addresses,
      { proposer: keys.proposer as Hex, keeper: keys.keeper as Hex, agents: agents as Record<AgentKey, Hex> },
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
  const chain = mode === "live" ? available : { layer: null, reason: "Simülasyon modu: hiçbir işlem gönderilmez" };
  // Live rounds submit from the configured operators, under the ids they hold on chain.
  let agents: readonly AgentSpec[] = AGENTS;
  if (chain.layer) {
    const r = await resolveAgentIds();
    const missing = AGENTS.filter((a) => !r.registered[a.key]).map((a) => a.name);
    if (missing.length) return { ok: false, reason: `Ajan operatörleri zincirde kayıtlı değil (${missing.join(", ")}); /kurulum sayfasından kaydedin` };
    agents = AGENTS.map((a) => ({ ...a, agentId: r.ids[a.key] }));
  }
  let reputation: ReputationRecords = { source: "none-recorded", records: {} };
  if (chain.layer) {
    reputation = await chain.layer.reputation();
  } else if (available.layer || deployment().deployed) {
    const views = await listAgents();
    const records: ReputationRecords["records"] = {};
    for (const v of views) {
      if (v.onChain.status !== "ok") return { ok: false, reason: `Ajan kaydı okunamadı: ${v.onChain.reason}` };
      records[v.spec.agentId] = { submitted: v.onChain.value.submitted, correct: v.onChain.value.correct };
    }
    reputation = { source: "chain", records };
  }

  return {
    ok: true,
    deps: {
      collectState,
      provider: provider.value,
      agents,
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
