import { parseEther } from "viem";

/**
 * Protocol parameters (CONTRACT_SPEC.md §8). These are the defaults the deploy script
 * sets; once deployed, the UI reads live values from the contracts instead.
 */
export const DEFAULT_PARAMS = {
  submissionWindowSec: 180,
  horizonSec: 180,
  bandBps: 10,
  thresholdBps: 6000,
  minActionScore: 5500,
  quorum: 4,
  lockPerAgent: parseEther("0.05"),
  slashBps: 3000,
  missPenaltyBps: 1000,
  roundReward: parseEther("0.02"),
  actionBps: 1000,
  maxMove: parseEther("0.5"),
  guardianWindowSec: 120,
  resolutionToleranceSec: 60,
} as const;

/**
 * The time scale rounds actually run at (the judge-facing demo): a 90 s submission window
 * and a 60 s horizon so a full round, including the verified outcome, fits in a few
 * minutes. The committed state, the agents' prompt and the on-chain config all use these
 * values; the mechanism is identical to the defaults above.
 */
export const ROUND_TIMING = { submissionWindowSec: 90, horizonSec: 60 } as const;

export const PARAM_CAPS = {
  submissionWindowSec: "≤ 1 h",
  horizonSec: "≤ 7 d",
  bandBps: "≤ 1000",
  thresholdBps: "≥ 5001",
  quorum: "≥ 3",
  slashBps: "≤ 5000",
  missPenaltyBps: "≤ 2000",
  actionBps: "≤ 2500",
} as const;
