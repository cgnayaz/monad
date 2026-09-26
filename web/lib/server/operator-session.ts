import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, keccak256, recoverMessageAddress, toBytes, zeroHash, type Hex } from "viem";
import { decisionEngineAbi, decisionRegistryAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { deployment } from "@/lib/chain/deployments";
import { MONAD_TESTNET } from "@/lib/config/public";
import type { Address } from "@/lib/types/protocol";
import { derivedSessionSecret } from "@/lib/chain/signers";

/**
 * Operator sessions. Anything that makes the server spend gas from its keys or lock agent
 * bonds (live rounds, keeper steps) requires an operator: a wallet that holds
 * DEFAULT_ADMIN_ROLE on DecisionRegistry or GUARDIAN_ROLE on DecisionEngine, proven by
 * signing a server-issued challenge. The session is an HMAC-signed, httpOnly cookie.
 *
 * Challenges are stateless (HMAC over issue time + random) and valid for 5 minutes; each is
 * accepted once per server instance. Sessions last 30 minutes.
 */

export const SESSION_COOKIE = "dm_operator";
const CHALLENGE_TTL = 5 * 60;
const SESSION_TTL = 30 * 60;
const used = new Set<string>();

function secret(): Buffer | null {
  const s = process.env.SESSION_SECRET?.trim() || derivedSessionSecret();
  return s && s.length >= 32 ? Buffer.from(s) : null;
}

function mac(data: string, key: Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionsConfigured(): boolean {
  return secret() !== null;
}

export function issueChallenge(): { message: string } | null {
  const key = secret();
  const d = deployment();
  if (!key || !d.deployed) return null;
  const issued = Math.floor(Date.now() / 1000);
  const rand = randomBytes(16).toString("hex");
  const nonce = `${issued}.${rand}.${mac(`${issued}.${rand}`, key)}`;
  const message = [
    "DecMarkt operator sign-in",
    `Chain: ${MONAD_TESTNET.id}`,
    `Registry: ${d.addresses.DecisionRegistry}`,
    `Nonce: ${nonce}`,
    "This signature proves wallet ownership. It sends no transaction and costs nothing.",
  ].join("\n");
  return { message };
}

export type SessionResult = { ok: true; cookie: string; address: Address; role: "admin" | "guardian" } | { ok: false; status: number; error: string };

/** Verify a signed challenge and the signer's on-chain role; return a session cookie value. */
export async function openSession(message: string, signature: Hex): Promise<SessionResult> {
  const key = secret();
  const d = deployment();
  if (!key) return { ok: false, status: 503, error: "Operator sessions are not configured (SESSION_SECRET)" };
  if (!d.deployed) return { ok: false, status: 503, error: "Contracts not deployed" };

  const lines = message.split("\n");
  const nonceLine = lines.find((l) => l.startsWith("Nonce: "));
  if (lines[0] !== "DecMarkt operator sign-in" || lines[1] !== `Chain: ${MONAD_TESTNET.id}` || lines[2] !== `Registry: ${d.addresses.DecisionRegistry}` || !nonceLine) {
    return { ok: false, status: 400, error: "Unexpected challenge" };
  }
  const [issued, rand, sig] = nonceLine.slice(7).split(".");
  if (!issued || !rand || !sig || !safeEqual(sig, mac(`${issued}.${rand}`, key))) return { ok: false, status: 400, error: "Invalid challenge" };
  const age = Math.floor(Date.now() / 1000) - Number(issued);
  if (!(age >= 0 && age <= CHALLENGE_TTL)) return { ok: false, status: 400, error: "Challenge expired" };
  if (used.has(rand)) return { ok: false, status: 400, error: "Challenge already used" };

  let address: Address;
  try {
    address = getAddress(await recoverMessageAddress({ message, signature }));
  } catch {
    return { ok: false, status: 400, error: "Invalid signature" };
  }

  const [isAdmin, isGuardian] = await Promise.all([
    publicClient.readContract({ address: d.addresses.DecisionRegistry, abi: decisionRegistryAbi, functionName: "hasRole", args: [zeroHash, address] }),
    publicClient.readContract({ address: d.addresses.DecisionEngine, abi: decisionEngineAbi, functionName: "hasRole", args: [keccak256(toBytes("GUARDIAN_ROLE")), address] }),
  ]);
  if (!isAdmin && !isGuardian) return { ok: false, status: 403, error: "This wallet holds neither DEFAULT_ADMIN_ROLE nor GUARDIAN_ROLE" };
  used.add(rand);

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const role = isAdmin ? "admin" : "guardian";
  const body = `${address}|${role}|${exp}`;
  return { ok: true, cookie: `${body}|${mac(body, key)}`, address, role };
}

/** The operator behind a request's session cookie, or null. */
export function operatorFromCookie(value: string | undefined): { address: Address; role: string; exp: number } | null {
  const key = secret();
  if (!key || !value) return null;
  const parts = value.split("|");
  if (parts.length !== 4) return null;
  const [address, role, exp, sig] = parts;
  if (!safeEqual(sig, mac(`${address}|${role}|${exp}`, key))) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return { address: address as Address, role, exp: Number(exp) };
}

export const SESSION_MAX_AGE = SESSION_TTL;
