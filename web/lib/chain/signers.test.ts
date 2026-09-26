import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./signers");
}

describe("signers from SIGNER_SEED", () => {
  it("derives seven distinct, deterministic keys", async () => {
    const a = (await load({ SIGNER_SEED: "s".repeat(64) })).signerAddresses();
    vi.resetModules();
    const b = (await load({ SIGNER_SEED: "s".repeat(64) })).signerAddresses();
    expect(a).toEqual(b);
    const all = [a.proposer, a.keeper, ...Object.values(a.agents)];
    expect(new Set(all).size).toBe(7);
    expect(all.every((x) => /^0x[0-9a-fA-F]{40}$/.test(x ?? ""))).toBe(true);
  });

  it("prefers explicit keys and reports none without a seed", async () => {
    const pk = "0x" + "11".repeat(32);
    const m = await load({ SIGNER_SEED: "s".repeat(64), KEEPER_PRIVATE_KEY: pk });
    expect(m.signerKeys().keeper).toBe(pk);
    vi.resetModules();
    vi.unstubAllEnvs();
    const n = await load({});
    expect(n.signerKeys().proposer).toBeNull();
  });
});
