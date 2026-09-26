import "server-only";
import { decodeFunctionData, type Abi } from "viem";
import { decisionEngineAbi, decisionRegistryAbi, executionVaultAbi, outcomeRegistryAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { CONTRACT_NAMES, deployment, type ContractName, type Deployment } from "@/lib/chain/deployments";
import { MONAD_TESTNET, PYTH } from "@/lib/config/public";
import { AGENTS } from "@/lib/jev/agents";
import { ACTION_SPACE } from "@/lib/model/action";
import type { Action } from "@/lib/model/action";
import type { Aggregation } from "@/lib/model/aggregation";
import type { Settlement, SettlementStatus } from "@/lib/model/accountability";
import type { SubmissionRecord } from "@/lib/model/decision";
import type { Outcome } from "@/lib/model/outcome";
import { toProbability, toScore } from "@/lib/model/primitives";
import type { AgentRef, DecisionProvenance, DecisionRecord } from "@/lib/model/provenance";
import type { LifecycleTransition, TxRef } from "@/lib/model/transaction";
import {
  FORKS,
  forkFromIndex,
  ok,
  SETTLEMENT_RESULTS,
  statusFromIndex,
  STATUSES,
  unavailable,
  type Address,
  type Availability,
  type Fork,
  type Hex,
  type Status,
} from "@/lib/types/protocol";

/**
 * Chain read models. Every value comes from contract storage, logs or transactions;
 * off-chain payloads are attached elsewhere after their hashes are checked.
 */

/** OutcomeRegistry.RESOLUTION_TOLERANCE (CONTRACT_SPEC.md §8). */
const RESOLUTION_TOLERANCE_SEC = 60;

export interface DecisionSummary {
  id: bigint;
  status: Status;
  stateHash: Hex;
  createdAt: number;
  participants: number;
}

type Deployed = Extract<Deployment, { deployed: true }>;

function requireDeployment(): Availability<Deployed> {
  const d = deployment();
  return d.deployed ? ok(d) : unavailable("Contracts are not yet deployed to Monad Testnet");
}

function rpcReason(err: unknown): string {
  return err instanceof Error ? `RPC read failed: ${err.message.split("\n")[0]}` : "RPC read failed";
}

const executable = (f: Fork): Exclude<Fork, "ESCALATE"> => {
  if (f === "ESCALATE") throw new Error("ESCALATE is not an executable fork");
  return f;
};

export async function listDecisions(limit = 50): Promise<Availability<DecisionSummary[]>> {
  const d = requireDeployment();
  if (d.status !== "ok") return d;
  const registry = d.value.addresses.DecisionRegistry;
  try {
    const count = await publicClient.readContract({ address: registry, abi: decisionRegistryAbi, functionName: "decisionCount" });
    const ids: bigint[] = [];
    for (let i = count; i >= 1n && ids.length < limit; i--) ids.push(i);
    const rows = await Promise.all(
      ids.map((id) => publicClient.readContract({ address: registry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] })),
    );
    return ok(
      rows.map((r) => ({
        id: r.id,
        status: statusFromIndex(r.status),
        stateHash: r.stateHash,
        createdAt: Number(r.createdAt),
        participants: r.participants.length,
      })),
    );
  } catch (err) {
    return unavailable(rpcReason(err));
  }
}

/** Reconstruct the full provenance of one decision from chain. */
export async function getDecisionProvenance(id: bigint): Promise<Availability<DecisionProvenance | null>> {
  const dep = requireDeployment();
  if (dep.status !== "ok") return dep;
  const addr = dep.value.addresses;
  const decisionId = id.toString();

  try {
    const count = await publicClient.readContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "decisionCount" });
    if (id < 1n || id > count) return ok(null);
    const r = await publicClient.readContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] });
    const status = statusFromIndex(r.status);
    const reached = (s: Status) => status !== "CANCELLED" && STATUSES.indexOf(status) >= STATUSES.indexOf(s);
    const participants = [...r.participants];

    const decision: DecisionRecord = {
      decisionId,
      status,
      stateHash: r.stateHash,
      questionsHash: r.questionSetHash,
      proposer: r.proposer,
      config: {
        submissionWindow: Number(r.config.submissionWindow),
        horizon: Number(r.config.horizon),
        bandBps: r.config.bandBps,
        thresholdBps: r.config.thresholdBps,
        minActionScore: r.config.minActionScore,
        quorum: r.config.quorum,
        allowedForks: r.config.allowedForks,
        questionCount: r.config.questionCount,
        lockPerAgent: r.config.lockPerAgent,
      },
      createdAt: Number(r.createdAt),
      openedAt: r.openedAt > 0n ? Number(r.openedAt) : null,
      deadline: r.deadline > 0n ? Number(r.deadline) : null,
      participants,
      roundReward: r.roundReward,
      transitions: await readTransitions(addr, id, r.statusBlock),
    };
    const txAt = (s: Status) => decision.transitions.find((t) => t.status === s)?.tx ?? null;

    const agents: AgentRef[] = await Promise.all(
      AGENTS.map(async (a) => {
        const onChain = await publicClient.readContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getAgent", args: [a.agentId] });
        return { agentId: a.agentId, key: a.key, name: a.name, operator: onChain.operator as Address };
      }),
    );

    // Every (participant, question) slot; empty slots have submittedAt = 0.
    const slots = participants.flatMap((agentId) =>
      Array.from({ length: decision.config.questionCount }, (_, q) => [agentId, q] as const),
    );
    const submissions: SubmissionRecord[] = (
      await Promise.all(
        slots.map(async ([agentId, q]) => {
          const s = await publicClient.readContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getSubmission", args: [id, agentId, q] });
          if (s.submittedAt === 0n) return null;
          return {
            decisionId,
            agentId,
            questionIndex: s.questionId,
            choice: forkFromIndex(s.choice),
            score: toScore(s.score),
            probability: toProbability(s.probability),
            reasonHash: s.reasonHash,
            bond: s.bond,
            submittedAt: Number(s.submittedAt),
          } satisfies SubmissionRecord;
        }),
      )
    ).filter((s): s is SubmissionRecord => s !== null);

    let aggregation: Aggregation | null = null;
    if (reached("AGGREGATED")) {
      const g = await publicClient.readContract({ address: addr.DecisionEngine, abi: decisionEngineAbi, functionName: "getAggregation", args: [id] });
      const pending = g.guardianRequired && status === "AGGREGATED";
      aggregation = {
        decisionId,
        source: "engine",
        inputs: [],
        support: Object.fromEntries(FORKS.map((f, i) => [f, g.support[i]])) as Record<Fork, bigint>,
        total: g.totalSupport,
        leading: forkFromIndex(g.leading),
        gates: null,
        passed: g.thresholdPassed,
        guardianRequired: g.guardianRequired,
        guardianDeadline: g.guardianRequired ? Number(g.guardianDeadline) : null,
        approved: pending ? null : executable(forkFromIndex(g.approved)),
        submissions: g.submissions,
      };
    }

    let action: Action | null = null;
    if (aggregation && aggregation.approved && reached("APPROVED")) {
      const approvedTx = txAt("APPROVED");
      const approvedBy: Action["approvedBy"] = !aggregation.passed
        ? "fail-safe"
        : !aggregation.guardianRequired
          ? "engine"
          : approvedTx?.functionName === "finalizeEscalation"
            ? "guardian-timeout"
            : "guardian";
      action = { decisionId, fork: aggregation.approved, definition: ACTION_SPACE[aggregation.approved], approvedBy, params: null, execution: null };
      if (reached("EXECUTED")) {
        const e = await publicClient.readContract({ address: addr.ExecutionVault, abi: executionVaultAbi, functionName: "getExecution", args: [id] });
        action.execution = {
          amountMoved: e.amountMoved,
          after: { active: e.activeAfter, reserve: e.reserveAfter },
          startPrice: { price: e.startPrice, expo: e.expo, publishTime: Number(e.startPublishTime) },
          executedAt: Number(e.executedAt),
          tx: txAt("EXECUTED"),
        };
      }
    }

    let outcome: Outcome | null = null;
    if (reached("RESOLVED") && action?.execution) {
      const o = await publicClient.readContract({ address: addr.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "getOutcome", args: [id] });
      const from = action.execution.executedAt + decision.config.horizon;
      const observed = o.isVoid
        ? null
        : {
            start: { price: o.startPrice, expo: o.expo, publishTime: action.execution.startPrice.publishTime },
            end: { price: o.endPrice, expo: o.expo, publishTime: Number(o.endPublishTime) },
            moveBps: o.outcomeValue,
            bandBps: decision.config.bandBps,
            correctFork: executable(forkFromIndex(o.observedResult)),
          };
      outcome = {
        decisionId,
        expectedAction: action.fork,
        observedResult: observed,
        success: observed ? o.success : null,
        verificationSource: {
          kind: "pyth",
          chainId: MONAD_TESTNET.id,
          contract: PYTH.contract,
          feedId: PYTH.monUsdFeedId,
          window: { from, to: from + RESOLUTION_TOLERANCE_SEC },
        },
        status: observed ? "VERIFIED" : "VOID",
        timestamp: Number(o.resolvedAt),
        tx: txAt("RESOLVED"),
      };
    }

    const settlementStatus: SettlementStatus =
      status === "CANCELLED" ? "RELEASED"
      : status === "RESOLVED" ? (outcome?.status === "VOID" ? "VOID" : "SETTLED")
      : status === "CREATED" ? "NOT_LOCKED"
      : "LOCKED";

    const lines = await Promise.all(
      participants.map(async (agentId) => {
        if (settlementStatus !== "SETTLED") {
          return { decisionId, agentId, bond: decision.config.lockPerAgent, settlementStatus, result: null, reward: 0n, penalty: 0n, net: 0n };
        }
        const l = await publicClient.readContract({ address: addr.OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "getSettlement", args: [id, agentId] });
        return {
          decisionId,
          agentId,
          bond: l.lockReleased,
          settlementStatus,
          result: SETTLEMENT_RESULTS[l.result] ?? null,
          reward: l.reward,
          penalty: l.penalty,
          net: l.reward - l.penalty,
        };
      }),
    );
    const settlement: Settlement = {
      decisionId,
      settlementStatus,
      lines,
      roundReward: decision.roundReward,
      // Only known exactly after settlement; derived from the settled lines.
      toRewardPool:
        settlementStatus === "SETTLED"
          ? lines.reduce((t, l) => t + l.penalty - l.reward, 0n) + decision.roundReward
          : settlementStatus === "NOT_LOCKED" || settlementStatus === "LOCKED" ? 0n : decision.roundReward,
      tx: settlementStatus === "SETTLED" || settlementStatus === "VOID" ? txAt("RESOLVED") : settlementStatus === "RELEASED" ? txAt("CANCELLED") : null,
    };

    return ok({
      decision,
      state: { stateId: null, hash: decision.stateHash },
      questions: { hash: decision.questionsHash },
      agents,
      submissions,
      parallel: null,
      aggregation,
      action,
      outcome,
      settlement,
    });
  } catch (err) {
    return unavailable(rpcReason(err));
  }
}

// ─── Transactions ───────────────────────────────────────────────────────────

const ABIS: Record<ContractName, Abi> = {
  DecisionRegistry: decisionRegistryAbi,
  DecisionEngine: decisionEngineAbi,
  ExecutionVault: executionVaultAbi,
  OutcomeRegistry: outcomeRegistryAbi,
};

/**
 * Transaction per lifecycle transition. StatusChanged logs are fetched at the exact block
 * recorded on-chain for each status (no wide log ranges); the transaction is then read
 * and its calldata decoded against our ABIs to name the contract and function called.
 */
async function readTransitions(addr: Record<ContractName, Address>, id: bigint, statusBlock: readonly bigint[]): Promise<LifecycleTransition[]> {
  const out: LifecycleTransition[] = [];
  for (let i = 1; i < statusBlock.length; i++) {
    const blockNumber = statusBlock[i];
    if (!blockNumber) continue;
    const status = statusFromIndex(i);
    let tx: TxRef | null = null;
    try {
      const logs = await publicClient.getContractEvents({
        address: addr.DecisionRegistry,
        abi: decisionRegistryAbi,
        eventName: "StatusChanged",
        args: { id },
        fromBlock: blockNumber,
        toBlock: blockNumber,
      });
      const hash = logs.find((l) => l.args.to === i)?.transactionHash;
      if (hash) tx = await describeTx(addr, hash, blockNumber);
    } catch {
      tx = null;
    }
    out.push({ status, blockNumber, tx });
  }
  return out;
}

async function describeTx(addr: Record<ContractName, Address>, hash: Hex, blockNumber: bigint): Promise<TxRef | null> {
  const t = await publicClient.getTransaction({ hash });
  const contract = CONTRACT_NAMES.find((n) => addr[n].toLowerCase() === t.to?.toLowerCase());
  if (!contract) return null;
  let functionName = "unknown";
  try {
    functionName = decodeFunctionData({ abi: ABIS[contract], data: t.input }).functionName;
  } catch {
    /* selector not in our ABI; keep "unknown" rather than guessing */
  }
  return { chainId: MONAD_TESTNET.id, hash, blockNumber, contract, functionName };
}
