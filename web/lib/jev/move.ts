import { BPS, type Fork } from "@/lib/types/protocol";

/**
 * The reference-market move and the fork it makes correct. Kept free of other Jev modules
 * so the browser (demo verification) can import it without the state and schema code.
 */

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
