import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

// Roles are read from chain; the test decides which wallet holds one.
const roles = vi.hoisted(() => ({ admin: new Set<string>() }));
vi.mock("@/lib/chain/client", () => ({
  publicClient: {
    readContract: async ({ functionName, args }: { functionName: string; args: [string, string] }) =>
      functionName === "hasRole" && roles.admin.has(args[1].toLowerCase()),
  },
}));

import { issueChallenge, openSession, operatorFromCookie } from "./operator-session";

// Anvil's well-known dev keys; never funded outside a local chain.
const operator = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const stranger = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("operator sessions (SECURITY_AUDIT.md H-2)", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "x".repeat(48));
    roles.admin = new Set([operator.address.toLowerCase()]);
  });

  it("opens a session for a wallet holding an operator role, once per challenge", async () => {
    const { message } = issueChallenge()!;
    const signature = await operator.signMessage({ message });
    const r = await openSession(message, signature);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(operatorFromCookie(r.cookie)?.address).toBe(operator.address);
    const replay = await openSession(message, signature);
    expect(replay).toMatchObject({ ok: false, error: "Challenge already used" });
  });

  it("rejects a wallet without a role", async () => {
    const { message } = issueChallenge()!;
    const r = await openSession(message, await stranger.signMessage({ message }));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a forged challenge", async () => {
    const { message } = issueChallenge()!;
    const forged = message.replace(/Nonce: (\d+)\.([0-9a-f]+)\./, "Nonce: $1.deadbeef.");
    const r = await openSession(forged, await operator.signMessage({ message: forged }));
    expect(r).toMatchObject({ ok: false, error: "Invalid challenge" });
  });

  it("rejects an expired challenge", async () => {
    const { message } = issueChallenge()!;
    const signature = await operator.signMessage({ message });
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 });
    try {
      expect(await openSession(message, signature)).toMatchObject({ ok: false, error: "Challenge expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects tampered and expired cookies", async () => {
    const { message } = issueChallenge()!;
    const r = await openSession(message, await operator.signMessage({ message }));
    if (!r.ok) throw new Error(r.error);
    expect(operatorFromCookie(r.cookie.replace("|admin|", "|guardian|"))).toBeNull();
    expect(operatorFromCookie(r.cookie.replace(operator.address, stranger.address))).toBeNull();
    vi.useFakeTimers({ now: Date.now() + 31 * 60_000 });
    try {
      expect(operatorFromCookie(r.cookie)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is disabled without a strong SESSION_SECRET", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    expect(issueChallenge()).toBeNull();
    expect(operatorFromCookie("a|admin|9999999999|00")).toBeNull();
  });
});
