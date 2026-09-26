import "server-only";
import { decisionRegistryAbi, executionVaultAbi, outcomeRegistryAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { deployment } from "@/lib/chain/deployments";
import type { SettlementParamsOnChain } from "@/lib/decmarkt/reproduce";
import {
  forkFromIndex,
  ok,
  SETTLEMENT_RESULTS,
  statusFromIndex,
  unavailable,
  type Address,
  type Availability,
  type Fork,
  type Hex,
  type SettlementResult,
  type Status,
} from "@/lib/types/protocol";
import { publicError } from "@/lib/server/public-error";

/**
 * Accountability reads. Everything here is contract storage: the penalty parameters and
 * oracle identity from OutcomeRegistry, and each agent's settled predictions.
 */

export async function settlementParams(): Promise<Availability<SettlementParamsOnChain>> {
  const d = deployment();
  if (!d.deployed) return unavailable("Contracts not deployed");
  try {
    const [slashBps, missPenaltyBps] = await Promise.all([
      publicClient.readContract({ address: d.addresses.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "slashBps" }),
      publicClient.readContract({ address: d.addresses.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "missPenaltyBps" }),
    ]);
    return ok({ slashBps, missPenaltyBps });
  } catch (err) {
    return unavailable(publicError(err, "RPC read failed"));
  }
}

/** The oracle OutcomeRegistry verifies against (immutable in the contract). */
export async function verificationOracle(): Promise<Availability<{ pyth: Address; priceId: Hex; toleranceSec: number }>> {
  const d = deployment();
  if (!d.deployed) return unavailable("Contracts not deployed");
  try {
    const [pyth, priceId, tol] = await Promise.all([
      publicClient.readContract({ address: d.addresses.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "pyth" }),
      publicClient.readContract({ address: d.addresses.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "priceId" }),
      publicClient.readContract({ address: d.addresses.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "RESOLUTION_TOLERANCE" }),
    ]);
    return ok({ pyth, priceId, toleranceSec: Number(tol) });
  } catch (err) {
    return unavailable(publicError(err, "RPC read failed"));
  }
}

export interface LedgerRow {
  decisionId: string;
  status: Status;
  createdAt: number;
  choice: Fork | null; // null = no final decision submitted
  score: number | null;
  probability: number | null;
  executed: Fork | null;
  observed: Fork | null;
  success: boolean | null; // did the executed action match the outcome
  result: SettlementResult | null; // null until settled
  lock: bigint;
  penalty: bigint;
  reward: bigint;
  net: bigint;
  resolvedAt: number | null;
}

export interface AgentLedger {
  rows: LedgerRow[];
  totals: { settled: number; correct: number; wrong: number; missed: number; neutral: number; penalty: bigint; reward: bigint; net: bigint };
  scanned: number;
  truncated: boolean;
}

const MAX_SCAN = 200;

/** Every decision this agent participated in, newest first, with what it predicted and what it cost or earned. */
export async function agentLedger(agentId: number): Promise<Availability<AgentLedger>> {
  const d = deployment();
  if (!d.deployed) return unavailable("Contracts not deployed");
  const { DecisionRegistry: reg, OutcomeRegistry: out, ExecutionVault: vault } = d.addresses;
  try {
    const count = await publicClient.readContract({ address: reg, abi: decisionRegistryAbi, functionName: "decisionCount" });
    const ids: bigint[] = [];
    for (let i = count; i >= 1n && ids.length < MAX_SCAN; i--) ids.push(i);

    const rows = (
      await Promise.all(
        ids.map(async (id): Promise<LedgerRow | null> => {
          const dec = await publicClient.readContract({ address: reg, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] });
          if (!dec.participants.includes(agentId)) return null;
          const status = statusFromIndex(dec.status);
          const [[submitted, sub], o, line] = await Promise.all([
            publicClient.readContract({ address: reg, abi: decisionRegistryAbi, functionName: "getFinalSubmission", args: [id, agentId] }),
            publicClient.readContract({ address: out, abi: outcomeRegistryAbi, functionName: "getOutcome", args: [id] }),
            publicClient.readContract({ address: out, abi: outcomeRegistryAbi, functionName: "getSettlement", args: [id, agentId] }),
          ]);
          const resolved = status === "RESOLVED";
          const executedOnChain = status === "EXECUTED" || resolved;
          const execution = executedOnChain ? await publicClient.readContract({ address: vault, abi: executionVaultAbi, functionName: "getExecution", args: [id] }) : null;
          const settled = resolved && !o.isVoid;
          return {
            decisionId: id.toString(),
            status,
            createdAt: Number(dec.createdAt),
            choice: submitted ? forkFromIndex(sub.choice) : null,
            score: submitted ? sub.score : null,
            probability: submitted ? sub.probability : null,
            executed: execution ? forkFromIndex(execution.action) : null,
            observed: settled ? forkFromIndex(o.observedResult) : null,
            success: settled ? o.success : null,
            result: settled ? (SETTLEMENT_RESULTS[line.result] ?? null) : null,
            lock: dec.config.lockPerAgent,
            penalty: settled ? line.penalty : 0n,
            reward: settled ? line.reward : 0n,
            net: settled ? line.reward - line.penalty : 0n,
            resolvedAt: resolved ? Number(o.resolvedAt) : null,
          };
        }),
      )
    ).filter((r): r is LedgerRow => r !== null);

    const s = rows.filter((r) => r.result !== null);
    return ok({
      rows,
      totals: {
        settled: s.length,
        correct: s.filter((r) => r.result === "CORRECT").length,
        wrong: s.filter((r) => r.result === "WRONG").length,
        missed: s.filter((r) => r.result === "MISSED").length,
        neutral: s.filter((r) => r.result === "NEUTRAL").length,
        penalty: s.reduce((t, r) => t + r.penalty, 0n),
        reward: s.reduce((t, r) => t + r.reward, 0n),
        net: s.reduce((t, r) => t + r.net, 0n),
      },
      scanned: ids.length,
      truncated: count > BigInt(MAX_SCAN),
    });
  } catch (err) {
    return unavailable(`RPC read failed: ${publicError(err, "unknown error")}`);
  }
}
