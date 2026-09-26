/**
 * Jev — the structured decision layer of DecMarkt (JEV_INTEGRATION.md).
 *
 *   State → Questions → Parallel Decisions → Choice · Score · Probability · Reason
 *         → Batch → Bounded Forks → Action → Verify
 *
 * Invariant: nothing in this module signs or sends a blockchain transaction.
 */

export * from "./state";
export * from "./questions";
export * from "./forks";
export * from "./score";
export * from "./primitives";
export * from "./batch";
export * from "./parallel";
export * from "./action";
export * from "./verify";
export * from "./agents";
export { canonicalJson, hashCanonical, hashText } from "./canonical";
