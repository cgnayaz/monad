import { BPS, type Fork, type Hex } from "@/lib/types/protocol";
import type { AgentDecision } from "@/lib/model/decision";
import type { ObservedResult, OraclePrice, Outcome, VerificationSource } from "@/lib/model/outcome";
import type { DecisionId, UnixSeconds } from "@/lib/model/primitives";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import type { TxRef } from "@/lib/model/transaction";
import { verifyBatchLeaf } from "./batch";
import { hashCanonical, hashText } from "./canonical";
import { computeQuestionSetHash } from "./questions";
import { computeStateHash } from "./state";

/**
 * Jev Verify (JEV_INTEGRATION.md §11).
 *
 * 1. Outcome verification — expected action vs. the fork the oracle move makes correct.
 *    Mirrors OutcomeRegistry.resolve; for a real decision the contract is authoritative.
 * 2. Integrity verification — recompute hashes of off-chain payloads and compare them
 *    with the values committed on-chain.
 */

export type { Outcome, ObservedResult, OraclePrice, VerificationSource } from "@/lib/model/outcome";

/** moveBps = (end − start) × 10000 / start, truncated toward zero like Solidity int division. */
export function moveBps(startPrice: bigint, endPrice: bigint): bigint {
  if (startPrice <= 0n) throw new Error("start price must be positive");
  return ((endPrice - startPrice) * BigInt(BPS)) / startPrice;
}

export function correctFork(startPrice: bigint, endPrice: bigint, bandBps: number): Exclude<Fork, "ESCALATE"> {
  const m = moveBps(startPrice, endPrice);
  const band = BigInt(bandBps);
  if (m < -band) return "DERISK";
  if (m > band) return "DEPLOY";
  return "NO_ACTION";
}

export function observe(start: OraclePrice, end: OraclePrice, bandBps: number): ObservedResult {
  if (start.expo !== end.expo) throw new Error("Price exponents differ");
  return {
    start,
    end,
    moveBps: moveBps(start.price, end.price),
    bandBps,
    correctFork: correctFork(start.price, end.price, bandBps),
  };
}

export function buildOutcome(args: {
  decisionId: DecisionId;
  expectedAction: Exclude<Fork, "ESCALATE">;
  observed: ObservedResult | null;
  source: VerificationSource;
  timestamp: UnixSeconds;
  tx: TxRef | null;
}): Outcome {
  const { observed } = args;
  return {
    decisionId: args.decisionId,
    expectedAction: args.expectedAction,
    observedResult: observed,
    success: observed ? observed.correctFork === args.expectedAction : null,
    verificationSource: args.source,
    status: observed ? "VERIFIED" : "VOID",
    timestamp: args.timestamp,
    tx: args.tx,
  };
}

// ─── Integrity ──────────────────────────────────────────────────────────────

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

export function checkState(onChain: Hex | null, state: StateRecord | null): IntegrityCheck {
  return compare("state", onChain, state ? computeStateHash(state) : null);
}

export function checkQuestionSet(onChain: Hex | null, set: QuestionSet | null): IntegrityCheck {
  return compare("questions", onChain, set ? computeQuestionSetHash(set) : null);
}

export function checkPayloadHash(label: string, onChain: Hex | null, payload: unknown | null): IntegrityCheck {
  return compare(label, onChain, payload === null ? null : hashCanonical(payload));
}

export function checkReasonHash(label: string, onChain: Hex | null, reason: string | null): IntegrityCheck {
  return compare(label, onChain, reason === null ? null : hashText(reason));
}

export function checkDecisionProof(root: Hex | null, decision: AgentDecision | null, proof: Hex[] | null): IntegrityStatus {
  if (!root || !decision || !proof) return "UNAVAILABLE";
  return verifyBatchLeaf(root, decision, proof) ? "VERIFIED" : "MISMATCH";
}
