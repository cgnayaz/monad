import "server-only";
import { keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { serverEnv } from "@/lib/config/server";
import { AGENTS } from "@/lib/jev/agents";
import type { Address, AgentKey } from "@/lib/types/protocol";

/**
 * Server signers. Each key comes from its explicit *_PRIVATE_KEY variable when set; otherwise
 * it is derived from SIGNER_SEED (one secret instead of seven). Derivation is deterministic,
 * so the same seed always yields the same addresses, which are registered on chain once via
 * the /kurulum page. Keys never leave the server; only addresses are ever exposed.
 */
export type SignerRole = "proposer" | "keeper" | AgentKey;

function derive(seed: string, role: SignerRole): Hex {
  return keccak256(stringToBytes(`decmarkt/v1/${role}/${seed}`));
}

export function signerKeys(): { proposer: Hex | null; keeper: Hex | null; agents: Record<AgentKey, Hex | null>; derived: boolean } {
  const env = serverEnv();
  const seed = env.SIGNER_SEED ?? null;
  const pick = (explicit: string | undefined, role: SignerRole) => (explicit as Hex | undefined) ?? (seed ? derive(seed, role) : null);
  return {
    proposer: pick(env.PROPOSER_PRIVATE_KEY, "proposer"),
    keeper: pick(env.KEEPER_PRIVATE_KEY, "keeper"),
    agents: Object.fromEntries(AGENTS.map((a) => [a.key, pick(env[a.operatorKeyEnv], a.key)])) as Record<AgentKey, Hex | null>,
    derived: !!seed,
  };
}

/** Public addresses of the configured signers (null where no key is available). */
export function signerAddresses(): { proposer: Address | null; keeper: Address | null; agents: Record<AgentKey, Address | null> } {
  const k = signerKeys();
  const addr = (h: Hex | null) => (h ? (privateKeyToAddress(h) as Address) : null);
  return {
    proposer: addr(k.proposer),
    keeper: addr(k.keeper),
    agents: Object.fromEntries(Object.entries(k.agents).map(([key, h]) => [key, addr(h)])) as Record<AgentKey, Address | null>,
  };
}

/** HMAC key for operator sessions when SESSION_SECRET is not set: derived from SIGNER_SEED. */
export function derivedSessionSecret(): string | null {
  const seed = serverEnv().SIGNER_SEED;
  return seed ? derive(seed, "session" as SignerRole) : null;
}
