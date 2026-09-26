import "server-only";
import { deployment } from "@/lib/chain/deployments";
import { serverEnv } from "@/lib/config/server";
import { AGENTS } from "@/lib/jev/agents";

/**
 * What the live round needs, reported as presence flags only. Secret values never
 * leave this function.
 */
export interface Readiness {
  contracts: { ok: boolean; detail: string };
  ai: { ok: boolean; detail: string };
  oracle: { ok: boolean; detail: string };
  signers: { ok: boolean; detail: string };
  ready: boolean;
  /** What a round can do right now. */
  mode: "live" | "simulation" | "unavailable";
  modeDetail: string;
  modes: {
    simulation: { ok: boolean; reason: string };
    live: { ok: boolean; reason: string };
  };
}

export function readiness(): Readiness {
  const env = serverEnv();
  const d = deployment();
  const agentKeys = AGENTS.filter((a) => !!env[a.operatorKeyEnv]).length;
  const signersOk = agentKeys === AGENTS.length && !!env.PROPOSER_PRIVATE_KEY && !!env.KEEPER_PRIVATE_KEY;

  const r = {
    contracts: d.deployed
      ? { ok: true, detail: "All four contracts deployed" }
      : { ok: false, detail: `Not deployed: ${d.missing.join(", ")}` },
    ai: env.ANTHROPIC_API_KEY
      ? { ok: true, detail: `Provider configured (${env.AI_MODEL})` }
      : { ok: false, detail: "ANTHROPIC_API_KEY not configured" },
    oracle: env.PYTH_API_KEY
      ? { ok: true, detail: "Pyth Hermes key configured" }
      : { ok: false, detail: "PYTH_API_KEY not configured (required by Hermes since 2026-08-26)" },
    signers: signersOk
      ? { ok: true, detail: "Proposer, keeper and 5 agent operators configured" }
      : { ok: false, detail: `${agentKeys}/5 agent operators, proposer ${env.PROPOSER_PRIVATE_KEY ? "set" : "missing"}, keeper ${env.KEEPER_PRIVATE_KEY ? "set" : "missing"}` },
  };
  const ready = r.contracts.ok && r.ai.ok && r.oracle.ok && r.signers.ok;
  const simulation = r.ai.ok
    ? { ok: true, reason: r.oracle.ok ? "Real state and real agents; execution, verification and settlement computed locally. No transactions." : "Runs up to the action; verification needs PYTH_API_KEY." }
    : { ok: false, reason: r.ai.detail };
  const live = !r.ai.ok
    ? { ok: false, reason: r.ai.detail }
    : !r.contracts.ok
      ? { ok: false, reason: r.contracts.detail }
      : !r.signers.ok
        ? { ok: false, reason: r.signers.detail }
        : !process.env.SESSION_SECRET
          ? { ok: false, reason: "SESSION_SECRET not configured (operator sign-in)" }
          : { ok: true, reason: r.oracle.ok ? "Every stage is a Monad Testnet transaction. Requires operator sign-in." : "Runs to approval; execution needs PYTH_API_KEY for a signed price." };
  const mode = live.ok ? "live" : simulation.ok ? "simulation" : "unavailable";
  const modeDetail = mode === "live" ? live.reason : mode === "simulation" ? simulation.reason : "No AI provider is configured, so no agent can evaluate. Nothing is simulated.";
  return { ...r, ready, mode, modeDetail, modes: { simulation, live } };
}
