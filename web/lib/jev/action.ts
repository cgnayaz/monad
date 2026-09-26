import { BPS, type Fork } from "@/lib/types/protocol";

/**
 * Jev Action (JEV_INTEGRATION.md §10).
 *
 * Describes what an approved fork does to the vault buckets. This is a pure preview
 * that mirrors ExecutionVault.execute; the contract is authoritative and the only
 * place an action actually happens. This module never sends transactions.
 */

export interface ActionParams {
  actionBps: number;
  maxMove: bigint;
}

export interface Buckets {
  active: bigint;
  reserve: bigint;
}

export interface ActionPreview {
  fork: Fork;
  amount: bigint;
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
      return {
        fork,
        amount,
        after: { active: buckets.active - amount, reserve: buckets.reserve + amount },
        requiresGuardian: false,
      };
    }
    case "DEPLOY": {
      const amount = min((buckets.reserve * BigInt(p.actionBps)) / BigInt(BPS), p.maxMove);
      return {
        fork,
        amount,
        after: { active: buckets.active + amount, reserve: buckets.reserve - amount },
        requiresGuardian: false,
      };
    }
    case "ESCALATE":
      return { fork, amount: 0n, after: { ...buckets }, requiresGuardian: true };
  }
}
