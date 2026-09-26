import { BPS, type Fork, type Hex } from "@/lib/types/protocol";
import { verifyBatchLeaf } from "./batch";
import { hashCanonical, hashText } from "./canonical";
import type { JevAnswer } from "./primitives";

/**
 * Jev Verify (JEV_INTEGRATION.md §11).
 *
 * 1. Outcome verification — which fork was correct, from start/end oracle prices.
 *    Mirrors OutcomeRegistry.resolve; the contract is authoritative.
 * 2. Integrity verification — recompute hashes of off-chain payloads and compare
 *    them with the values committed on-chain.
 */

/** moveBps = (end − start) × 10000 / start, truncated toward zero like Solidity int division. */
export function moveBps(startPrice: bigint, endPrice: bigint): bigint {
  if (startPrice <= 0n) throw new Error("start price must be positive");
  return ((endPrice - startPrice) * BigInt(BPS)) / startPrice;
}

export function correctFork(startPrice: bigint, endPrice: bigint, bandBps: number): Fork {
  const m = moveBps(startPrice, endPrice);
  const band = BigInt(bandBps);
  if (m < -band) return "DERISK";
  if (m > band) return "DEPLOY";
  return "NO_ACTION";
}

export type IntegrityStatus = "VERIFIED" | "MISMATCH" | "UNAVAILABLE";

export interface IntegrityCheck {
  label: string;
  onChain: Hex | null;
  recomputed: Hex | null;
  status: IntegrityStatus;
}

function compare(label: string, onChain: Hex | null, recomputed: Hex | null): IntegrityCheck {
  if (!onChain || !recomputed) return { label, onChain, recomputed, status: "UNAVAILABLE" };
  return {
    label,
    onChain,
    recomputed,
    status: onChain.toLowerCase() === recomputed.toLowerCase() ? "VERIFIED" : "MISMATCH",
  };
}

export function checkPayloadHash(label: string, onChain: Hex | null, payload: unknown | null): IntegrityCheck {
  return compare(label, onChain, payload === null ? null : hashCanonical(payload));
}

export function checkReasonHash(label: string, onChain: Hex | null, reason: string | null): IntegrityCheck {
  return compare(label, onChain, reason === null ? null : hashText(reason));
}

export function checkAnswerProof(root: Hex | null, answer: JevAnswer | null, proof: Hex[] | null): IntegrityStatus {
  if (!root || !answer || !proof) return "UNAVAILABLE";
  return verifyBatchLeaf(root, answer, proof) ? "VERIFIED" : "MISMATCH";
}
