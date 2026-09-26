import { FORKS, type Fork } from "@/lib/types/protocol";

/**
 * Jev Bounded Forks (JEV_INTEGRATION.md §8).
 *
 * The fork set is closed and fixed at compile time, matching the Solidity enum.
 * Agents choose a label from this set; they never supply amounts, addresses or calldata.
 */

export interface ForkSpec {
  fork: Fork;
  alias: "NO_ACTION" | "ACTION_A" | "ACTION_B" | "ESCALATE";
  label: string;
  effect: string;
  executable: boolean; // false → requires a guardian before anything executes
}

export const FORK_SPECS: Record<Fork, ForkSpec> = {
  NO_ACTION: {
    fork: "NO_ACTION",
    alias: "NO_ACTION",
    label: "No action",
    effect: "Nothing moves. The start price is still recorded so the decision remains verifiable.",
    executable: true,
  },
  DERISK: {
    fork: "DERISK",
    alias: "ACTION_A",
    label: "De-risk",
    effect: "Move min(actionBps × ACTIVE, maxMove) from ACTIVE to RESERVE.",
    executable: true,
  },
  DEPLOY: {
    fork: "DEPLOY",
    alias: "ACTION_B",
    label: "Deploy",
    effect: "Move min(actionBps × RESERVE, maxMove) from RESERVE to ACTIVE.",
    executable: true,
  },
  ESCALATE: {
    fork: "ESCALATE",
    alias: "ESCALATE",
    label: "Escalate",
    effect:
      "No automatic action. A guardian selects NO_ACTION, DERISK or DEPLOY before a deadline; otherwise NO_ACTION.",
    executable: false,
  },
};

export const ALL_FORKS_MASK = FORKS.reduce((m, _f, i) => m | (1 << i), 0);

export function forksToMask(forks: readonly Fork[]): number {
  return forks.reduce((m, f) => m | (1 << FORKS.indexOf(f)), 0);
}

export function maskToForks(mask: number): Fork[] {
  return FORKS.filter((_f, i) => (mask & (1 << i)) !== 0);
}

/** Closed mapping from a model-provided label to a fork. Anything else is rejected. */
export function parseFork(label: string): Fork | null {
  return (FORKS as readonly string[]).includes(label) ? (label as Fork) : null;
}

/** Tie-break order used by the engine: the safest fork wins ties (CONTRACT_SPEC.md §5). */
export const TIE_BREAK_ORDER: readonly Fork[] = ["NO_ACTION", "ESCALATE", "DERISK", "DEPLOY"];
