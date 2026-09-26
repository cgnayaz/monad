import "server-only";
import { decisionEngineAbi, decisionRegistryAbi, executionVaultAbi, outcomeRegistryAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { deployment, type Deployment } from "@/lib/chain/deployments";
import {
  forkFromIndex,
  ok,
  SETTLEMENT_RESULTS,
  statusFromIndex,
  STATUSES,
  unavailable,
  type Availability,
  type Fork,
  type Hex,
  type SettlementResult,
  type Status,
} from "@/lib/types/protocol";

/**
 * Read models for decisions. Every value here comes from contract storage or logs.
 */

export interface DecisionSummary {
  id: bigint;
  status: Status;
  stateHash: Hex;
  createdAt: number;
  participants: number;
}

export interface SubmissionView {
  agentId: number;
  submitted: boolean;
  choice: Fork | null;
  score: number | null;
  probability: number | null;
  reasonHash: Hex | null;
  answersRoot: Hex | null;
  submittedAt: number | null;
}

export interface DecisionDetail extends DecisionSummary {
  questionsHash: Hex;
  proposer: Hex;
  openedAt: number;
  deadline: number;
  roundReward: bigint;
  config: {
    submissionWindow: number;
    horizon: number;
    bandBps: number;
    thresholdBps: number;
    minActionScore: number;
    quorum: number;
    allowedForks: number;
    lockPerAgent: bigint;
  };
  transitions: { status: Status; block: bigint; txHash: Hex | null }[];
  submissions: SubmissionView[];
  aggregation: {
    support: bigint[];
    totalSupport: bigint;
    leading: Fork;
    thresholdPassed: boolean;
    approved: Fork;
    guardianRequired: boolean;
    guardianDeadline: number;
    submissions: number;
  } | null;
  execution: {
    action: Fork;
    amountMoved: bigint;
    activeAfter: bigint;
    reserveAfter: bigint;
    startPrice: bigint;
    expo: number;
    startPublishTime: number;
    executedAt: number;
  } | null;
  outcome: { endPrice: bigint; endPublishTime: number; moveBps: bigint; correctFork: Fork; resolvedAt: number } | null;
  settlement: { agentId: number; result: SettlementResult; lockReleased: bigint; penalty: bigint; reward: bigint }[] | null;
}

type Deployed = Extract<Deployment, { deployed: true }>;

function requireDeployment(): Availability<Deployed> {
  const d = deployment();
  return d.deployed ? ok(d) : unavailable("Contracts are not yet deployed to Monad Testnet");
}

function rpcReason(err: unknown): string {
  return err instanceof Error ? `RPC read failed: ${err.message.split("\n")[0]}` : "RPC read failed";
}

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

export async function getDecision(id: bigint): Promise<Availability<DecisionDetail | null>> {
  const d = requireDeployment();
  if (d.status !== "ok") return d;
  const { DecisionRegistry, DecisionEngine, ExecutionVault, OutcomeRegistry } = d.value.addresses;
  try {
    const count = await publicClient.readContract({ address: DecisionRegistry, abi: decisionRegistryAbi, functionName: "decisionCount" });
    if (id < 1n || id > count) return ok(null);
    const r = await publicClient.readContract({ address: DecisionRegistry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] });
    const status = statusFromIndex(r.status);
    const reached = (s: Status) => STATUSES.indexOf(status) >= STATUSES.indexOf(s) && status !== "CANCELLED";

    const submissions = await Promise.all(
      r.participants.map(async (agentId): Promise<SubmissionView> => {
        const s = await publicClient.readContract({
          address: DecisionRegistry,
          abi: decisionRegistryAbi,
          functionName: "getSubmission",
          args: [id, agentId],
        });
        const submitted = s.submittedAt > 0n;
        return {
          agentId,
          submitted,
          choice: submitted ? forkFromIndex(s.choice) : null,
          score: submitted ? s.score : null,
          probability: submitted ? s.probability : null,
          reasonHash: submitted ? s.reasonHash : null,
          answersRoot: submitted ? s.answersRoot : null,
          submittedAt: submitted ? Number(s.submittedAt) : null,
        };
      }),
    );

    const agg = reached("AGGREGATED")
      ? await publicClient.readContract({ address: DecisionEngine, abi: decisionEngineAbi, functionName: "getAggregation", args: [id] })
      : null;
    const exe = reached("EXECUTED")
      ? await publicClient.readContract({ address: ExecutionVault, abi: executionVaultAbi, functionName: "getExecution", args: [id] })
      : null;
    const out = reached("RESOLVED")
      ? await publicClient.readContract({ address: OutcomeRegistry, abi: outcomeRegistryAbi, functionName: "getOutcome", args: [id] })
      : null;
    const settlement = out
      ? await Promise.all(
          r.participants.map(async (agentId) => {
            const l = await publicClient.readContract({
              address: OutcomeRegistry,
              abi: outcomeRegistryAbi,
              functionName: "getSettlement",
              args: [id, agentId],
            });
            return {
              agentId,
              result: SETTLEMENT_RESULTS[l.result],
              lockReleased: l.lockReleased,
              penalty: l.penalty,
              reward: l.reward,
            };
          }),
        )
      : null;

    const transitions = await readTransitions(DecisionRegistry, id, r.statusBlock);

    return ok({
      id: r.id,
      status,
      stateHash: r.stateHash,
      questionsHash: r.questionsHash,
      proposer: r.proposer,
      createdAt: Number(r.createdAt),
      openedAt: Number(r.openedAt),
      deadline: Number(r.deadline),
      participants: r.participants.length,
      roundReward: r.roundReward,
      config: {
        submissionWindow: Number(r.config.submissionWindow),
        horizon: Number(r.config.horizon),
        bandBps: r.config.bandBps,
        thresholdBps: r.config.thresholdBps,
        minActionScore: r.config.minActionScore,
        quorum: r.config.quorum,
        allowedForks: r.config.allowedForks,
        lockPerAgent: r.config.lockPerAgent,
      },
      transitions,
      submissions,
      aggregation: agg && {
        support: [...agg.support],
        totalSupport: agg.totalSupport,
        leading: forkFromIndex(agg.leading),
        thresholdPassed: agg.thresholdPassed,
        approved: forkFromIndex(agg.approved),
        guardianRequired: agg.guardianRequired,
        guardianDeadline: Number(agg.guardianDeadline),
        submissions: agg.submissions,
      },
      execution: exe && {
        action: forkFromIndex(exe.action),
        amountMoved: exe.amountMoved,
        activeAfter: exe.activeAfter,
        reserveAfter: exe.reserveAfter,
        startPrice: exe.startPrice,
        expo: exe.expo,
        startPublishTime: Number(exe.startPublishTime),
        executedAt: Number(exe.executedAt),
      },
      outcome: out && {
        endPrice: out.endPrice,
        endPublishTime: Number(out.endPublishTime),
        moveBps: out.moveBps,
        correctFork: forkFromIndex(out.correctFork),
        resolvedAt: Number(out.resolvedAt),
      },
      settlement,
    });
  } catch (err) {
    return unavailable(rpcReason(err));
  }
}

/**
 * Transaction hash per lifecycle transition: StatusChanged logs are fetched at the exact
 * block recorded on-chain for each status, so no wide log-range queries are needed.
 */
async function readTransitions(registry: Hex, id: bigint, statusBlock: readonly bigint[]) {
  const out: { status: Status; block: bigint; txHash: Hex | null }[] = [];
  for (let i = 1; i < statusBlock.length; i++) {
    const block = statusBlock[i];
    if (!block) continue;
    const status = statusFromIndex(i);
    let txHash: Hex | null = null;
    try {
      const logs = await publicClient.getContractEvents({
        address: registry,
        abi: decisionRegistryAbi,
        eventName: "StatusChanged",
        args: { id },
        fromBlock: block,
        toBlock: block,
      });
      txHash = logs.find((l) => l.args.to === i)?.transactionHash ?? null;
    } catch {
      txHash = null;
    }
    out.push({ status, block, txHash });
  }
  return out;
}
