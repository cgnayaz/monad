import type { Address, Fork, Hex } from "@/lib/types/protocol";
import type { DecisionId, UnixSeconds } from "./primitives";
import type { TxRef } from "./transaction";

/**
 * Verify / Outcome (JEV_INTEGRATION.md §11).
 *
 *   expectedAction · observedResult · success · verificationSource · timestamp
 */

export interface OraclePrice {
  price: bigint;
  expo: number;
  publishTime: UnixSeconds;
}

export interface ObservedResult {
  start: OraclePrice;
  end: OraclePrice;
  moveBps: bigint;
  bandBps: number;
  /** The fork that would have been right, derived from moveBps and the band. */
  correctFork: Exclude<Fork, "ESCALATE">;
}

export type VerificationSource =
  | { kind: "pyth"; chainId: number; contract: Address; feedId: Hex; window: { from: UnixSeconds; to: UnixSeconds } }
  | { kind: "preview" }; // computed off-chain; never shown as a verified outcome

export interface Outcome {
  decisionId: DecisionId;
  /** The action that was executed. */
  expectedAction: Exclude<Fork, "ESCALATE">;
  /** null when the outcome was voided (no valid oracle update inside the window). */
  observedResult: ObservedResult | null;
  /** expectedAction === observedResult.correctFork; null when void. */
  success: boolean | null;
  verificationSource: VerificationSource;
  status: "VERIFIED" | "VOID";
  timestamp: UnixSeconds;
  tx: TxRef | null;
}
