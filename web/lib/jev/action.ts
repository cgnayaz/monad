import { BPS, type Fork } from "@/lib/types/protocol";
import { ACTION_SPACE, type Action, type ActionParams, type Buckets } from "@/lib/model/action";
import type { Aggregation } from "@/lib/model/aggregation";
import type { Wei } from "@/lib/model/primitives";

/**
 * Jev Action (JEV_INTEGRATION.md §10).
 *
 * Resolves which entry of the finite action space a decision authorises, and previews
 * its effect on the vault buckets. The preview mirrors ExecutionVault.execute; the
 * contract is authoritative and the only place an action happens. No transactions here.
 */

export type { Action, ActionParams, Buckets } from "@/lib/model/action";

export interface ActionPreview {
  fork: Fork;
  amount: Wei;
  after: Buckets;
  requiresGuardian: boolean;
}

export function previewAction(fork: Fork, buckets: Buckets, p: ActionParams): ActionPreview {
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  switch (fork) {
    case "NO_ACTION":
      return { fork, amount: 0n, after: { ...buckets }, requiresGuardian: false };
    case "DERISK": {
      const amount = min((buckets.active * BigInt(p.actionBps)) / BigInt(BPS), p.maxMove);
      return { fork, amount, after: { active: buckets.active - amount, reserve: buckets.reserve + amount }, requiresGuardian: false };
    }
    case "DEPLOY": {
      const amount = min((buckets.reserve * BigInt(p.actionBps)) / BigInt(BPS), p.maxMove);
      return { fork, amount, after: { active: buckets.active + amount, reserve: buckets.reserve - amount }, requiresGuardian: false };
    }
    case "ESCALATE":
      return { fork, amount: 0n, after: { ...buckets }, requiresGuardian: true };
  }
}

/**
 * The Action a finished aggregation authorises, or null while a guardian decision is
 * pending. `guardianFork` is the guardian's on-chain choice, if any.
 */
export function resolveAction(
  aggregation: Aggregation,
  guardian: { fork: Exclude<Fork, "ESCALATE"> | null; timedOut: boolean } = { fork: null, timedOut: false },
): Action | null {
  const make = (fork: Exclude<Fork, "ESCALATE">, approvedBy: Action["approvedBy"]): Action => ({
    decisionId: aggregation.decisionId,
    fork,
    definition: ACTION_SPACE[fork],
    approvedBy,
    params: null,
    execution: null,
  });
  if (!aggregation.passed) return make("NO_ACTION", "fail-safe");
  if (aggregation.guardianRequired) {
    if (guardian.fork) return make(guardian.fork, "guardian");
    if (guardian.timedOut) return make("NO_ACTION", "guardian-timeout");
    return null;
  }
  return aggregation.approved ? make(aggregation.approved, "engine") : null;
}
