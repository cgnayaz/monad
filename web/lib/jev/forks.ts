import { FORKS, type Fork } from "@/lib/types/protocol";
import { ACTION_SPACE, type ForkSpace, type ProtocolAction } from "@/lib/model/action";

/**
 * Jev Bounded Forks (JEV_INTEGRATION.md §8).
 *
 * The fork set is closed and fixed at compile time, matching the Solidity enum. Each
 * fork maps to exactly one entry of ACTION_SPACE. Agents choose a label from this set;
 * they never supply amounts, addresses or calldata.
 */

export type { ForkSpace, ProtocolAction } from "@/lib/model/action";
export { ACTION_SPACE } from "@/lib/model/action";

/** Backwards-compatible name for the action table used by the UI. */
export const FORK_SPECS: Readonly<Record<Fork, ProtocolAction>> = ACTION_SPACE;

export const ALL_FORKS_MASK = FORKS.reduce((m, _f, i) => m | (1 << i), 0);

export function forksToMask(forks: readonly Fork[]): number {
  return forks.reduce((m, f) => m | (1 << FORKS.indexOf(f)), 0);
}

export function maskToForks(mask: number): Fork[] {
  return FORKS.filter((_f, i) => (mask & (1 << i)) !== 0);
}

/** The allowed action space for one decision, fixed before any agent runs. */
export function forkSpace(allowed: readonly Fork[] = FORKS): ForkSpace {
  const unique = FORKS.filter((f) => allowed.includes(f));
  if (!unique.includes("NO_ACTION")) throw new Error("NO_ACTION must always be allowed (fail-safe)");
  return { allowed: unique, mask: forksToMask(unique) };
}

/** Closed mapping from a model-provided label to a fork. Anything else is rejected. */
export function parseFork(label: string): Fork | null {
  return (FORKS as readonly string[]).includes(label) ? (label as Fork) : null;
}

/** Tie-break order used by the engine: the safest fork wins ties (CONTRACT_SPEC.md §5). */
export const TIE_BREAK_ORDER: readonly Fork[] = ["NO_ACTION", "ESCALATE", "DERISK", "DEPLOY"];
