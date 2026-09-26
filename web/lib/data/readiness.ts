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
  mode: "live" | "preview" | "unavailable";
  modeDetail: string;
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
  const mode = !r.ai.ok ? "unavailable" : r.contracts.ok && r.signers.ok ? "live" : "preview";
  const modeDetail =
    mode === "unavailable"
      ? "No AI provider is configured, so no agent can evaluate. Nothing is simulated."
      : mode === "preview"
        ? "Preview: real state and real agents; nothing is written on-chain until contracts and signers are configured."
        : r.oracle.ok
          ? "Live: every stage is a Monad Testnet transaction."
          : "Live up to approval; execution needs PYTH_API_KEY for a signed price.";
  return { ...r, ready, mode, modeDetail };
}
