import "server-only";
import { createWalletClient, http, parseEventLogs, type Account, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { leadingMetrics } from "@/lib/decmarkt/aggregate";
import type { ExecutionLayer, ReputationRecords } from "@/lib/engine/ports";
import { forksToMask } from "@/lib/jev/forks";
import type { AgentSpec } from "@/lib/jev/agents";
import { ACTION_SPACE, type Action } from "@/lib/model/action";
import type { Aggregation } from "@/lib/model/aggregation";
import type { DecisionBatch } from "@/lib/model/decision";
import type { DecisionParameters } from "@/lib/model/final-decision";
import { toProbability, toScore, type DecisionId } from "@/lib/model/primitives";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import type { TxRef } from "@/lib/model/transaction";
import { FORKS, forkFromIndex, statusFromIndex, type Address, type AgentKey, type Fork, type Hex, type Status } from "@/lib/types/protocol";
import { decisionEngineAbi, decisionRegistryAbi, executionVaultAbi, outcomeRegistryAbi } from "./abis";
import { publicClient } from "./client";
import type { ContractName } from "./deployments";
import { monadTestnet } from "./monad";
import { PYTH } from "@/lib/config/public";

/**
 * DecMarkt execution layer on Monad. Every transaction targets a fixed contract function
 * with arguments assembled here from validated data: hashes, enum indices, integers in
 * range. Keys are used only in this module and never reach the AI layer or the browser.
 */

const pythFeeAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;

export interface Signers {
  proposer: Hex;
  keeper: Hex;
  agents: Record<AgentKey, Hex>;
}

export interface PriceUpdateSource {
  latest(): Promise<{ data: Hex[]; publishTime: number }>;
  at(timestamp: number): Promise<{ data: Hex[]; publishTime: number }>;
}

type Addresses = Record<ContractName, Address>;

export class ChainExecutionLayer implements ExecutionLayer {
  private readonly proposer: Account;
  private readonly keeper: Account;
  private readonly agentAccounts: Record<AgentKey, Account>;

  constructor(
    private readonly addr: Addresses,
    signers: Signers,
    private readonly prices: PriceUpdateSource,
  ) {
    this.proposer = privateKeyToAccount(signers.proposer);
    this.keeper = privateKeyToAccount(signers.keeper);
    this.agentAccounts = Object.fromEntries(
      Object.entries(signers.agents).map(([k, v]) => [k, privateKeyToAccount(v)]),
    ) as Record<AgentKey, Account>;
  }

  private wallet(account: Account) {
    return createWalletClient({ account, chain: monadTestnet, transport: http(monadTestnet.rpcUrls.default.http[0]) });
  }

  /** Wait for the receipt; a reverted transaction is an error, never a success. */
  private async confirm(hash: Hash, contract: ContractName, functionName: string) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${contract}.${functionName} reverted (${hash})`);
    const tx: TxRef = { chainId: monadTestnet.id, hash, blockNumber: receipt.blockNumber, contract, functionName };
    return { receipt, tx };
  }

  async commit(state: StateRecord, questions: QuestionSet, p: DecisionParameters) {
    const w = this.wallet(this.proposer);
    const cfg = {
      submissionWindow: BigInt(p.submissionWindow),
      horizon: BigInt(p.horizon),
      bandBps: p.bandBps,
      thresholdBps: p.thresholdBps,
      minActionScore: p.minActionScore,
      quorum: p.quorum,
      allowedForks: forksToMask(p.allowedForks),
      questionCount: questions.questions.length,
      lockPerAgent: p.lockPerAgent,
    };
    const h1 = await w.writeContract({
      address: this.addr.DecisionRegistry,
      abi: decisionRegistryAbi,
      functionName: "createDecision",
      args: [state.hash, questions.hash, cfg],
    });
    const created = await this.confirm(h1, "DecisionRegistry", "createDecision");
    const [log] = parseEventLogs({ abi: decisionRegistryAbi, logs: created.receipt.logs, eventName: "DecisionCreated" });
    if (!log) throw new Error("DecisionCreated event missing");
    const id = log.args.id;

    const h2 = await w.writeContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "openDecision", args: [id] });
    const opened = await this.confirm(h2, "DecisionRegistry", "openDecision");
    const d = await publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] });
    return { decisionId: id.toString(), participants: [...d.participants], deadline: Number(d.deadline), txs: [created.tx, opened.tx] };
  }

  async submitBatch(decisionId: DecisionId, agent: AgentSpec, batch: DecisionBatch) {
    if (batch.agentId !== agent.agentId || batch.decisionId !== decisionId) throw new Error("Batch does not belong to this agent and decision");
    const answers = batch.decisions.map((d) => ({
      questionId: d.questionIndex,
      choice: FORKS.indexOf(d.choice),
      score: d.score,
      probability: d.probability,
      reasonHash: d.reasonHash,
    }));
    const hash = await this.wallet(this.agentAccounts[agent.key]).writeContract({
      address: this.addr.DecisionRegistry,
      abi: decisionRegistryAbi,
      functionName: "submitBatch",
      args: [BigInt(decisionId), agent.agentId, answers],
    });
    return (await this.confirm(hash, "DecisionRegistry", "submitBatch")).tx;
  }

  async aggregate(decisionId: DecisionId) {
    const hash = await this.wallet(this.keeper).writeContract({
      address: this.addr.DecisionEngine,
      abi: decisionEngineAbi,
      functionName: "aggregate",
      args: [BigInt(decisionId)],
    });
    const { tx } = await this.confirm(hash, "DecisionEngine", "aggregate");
    return { tx, status: await this.status(decisionId) };
  }

  async readAggregation(decisionId: DecisionId): Promise<Aggregation> {
    const id = BigInt(decisionId);
    const [g, d, status] = await Promise.all([
      publicClient.readContract({ address: this.addr.DecisionEngine, abi: decisionEngineAbi, functionName: "getAggregation", args: [id] }),
      publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] }),
      this.status(decisionId),
    ]);
    const finals = (
      await Promise.all(
        d.participants.map((a) =>
          publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getFinalSubmission", args: [id, a] }),
        ),
      )
    )
      .filter(([submitted]) => submitted)
      .map(([, s]) => ({ choice: forkFromIndex(s.choice), score: toScore(s.score), probability: toProbability(s.probability) }));
    const support = Object.fromEntries(FORKS.map((f, i) => [f, g.support[i]])) as Record<Fork, bigint>;
    const leading = forkFromIndex(g.leading);
    const pending = g.guardianRequired && status === "AGGREGATED";
    const approved = forkFromIndex(g.approved);
    return {
      decisionId,
      source: "engine",
      inputs: [],
      support,
      total: g.totalSupport,
      leading,
      gates: null,
      passed: g.thresholdPassed,
      guardianRequired: g.guardianRequired,
      guardianDeadline: g.guardianRequired ? Number(g.guardianDeadline) : null,
      approved: pending || approved === "ESCALATE" ? null : approved,
      submissions: g.submissions,
      ...leadingMetrics(leading, support, g.totalSupport, finals),
    };
  }

  async execute(decisionId: DecisionId, action: Action) {
    const id = BigInt(decisionId);
    const onChain = forkFromIndex(
      await publicClient.readContract({ address: this.addr.DecisionEngine, abi: decisionEngineAbi, functionName: "approvedAction", args: [id] }),
    );
    if (onChain !== action.fork) throw new Error(`On-chain approved action ${onChain} differs from ${action.fork}; not executing`);
    const update = await this.prices.latest();
    const fee = await publicClient.readContract({ address: PYTH.contract, abi: pythFeeAbi, functionName: "getUpdateFee", args: [update.data] });
    const hash = await this.wallet(this.keeper).writeContract({
      address: this.addr.ExecutionVault,
      abi: executionVaultAbi,
      functionName: "execute",
      args: [id, update.data],
      value: fee,
    });
    const { tx } = await this.confirm(hash, "ExecutionVault", "execute");
    const e = await publicClient.readContract({ address: this.addr.ExecutionVault, abi: executionVaultAbi, functionName: "getExecution", args: [id] });
    return { tx, executedAt: Number(e.executedAt) };
  }

  /** OutcomeRegistry.resolve with a signed price published just after executedAt + horizon. */
  async resolve(decisionId: DecisionId): Promise<{ tx: TxRef }> {
    const id = BigInt(decisionId);
    const [d, e] = await Promise.all([
      publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] }),
      publicClient.readContract({ address: this.addr.ExecutionVault, abi: executionVaultAbi, functionName: "getExecution", args: [id] }),
    ]);
    const t0 = Number(e.executedAt + d.config.horizon);
    if ((await this.chainTime()) < t0 + 1) throw new Error(`Horizon not reached; resolvable after ${t0}`);
    const update = await this.prices.at(t0 + 1);
    const fee = await publicClient.readContract({ address: PYTH.contract, abi: pythFeeAbi, functionName: "getUpdateFee", args: [update.data] });
    const hash = await this.wallet(this.keeper).writeContract({
      address: this.addr.OutcomeRegistry,
      abi: outcomeRegistryAbi,
      functionName: "resolve",
      args: [id, update.data],
      value: fee,
    });
    return { tx: (await this.confirm(hash, "OutcomeRegistry", "resolve")).tx };
  }

  /**
   * Perform the next permissionless lifecycle step for a decision, if it is due. Used to
   * resume a round (aggregation after the deadline, escalation timeout, execution, outcome).
   */
  async advance(decisionId: DecisionId): Promise<{ step: string; tx: TxRef | null; status: Status; note?: string }> {
    const id = BigInt(decisionId);
    const status = await this.status(decisionId);
    const now = await this.chainTime();
    const d = await publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getDecision", args: [id] });

    switch (status) {
      case "OPEN": {
        const finals = await publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "finalSubmissionCount", args: [id] });
        if (now <= Number(d.deadline) && finals < d.participants.length) {
          return { step: "aggregate", tx: null, status, note: `available after ${Number(d.deadline) + 1}` };
        }
        const r = await this.aggregate(decisionId);
        return { step: "aggregate", tx: r.tx, status: r.status };
      }
      case "AGGREGATED": {
        const g = await publicClient.readContract({ address: this.addr.DecisionEngine, abi: decisionEngineAbi, functionName: "getAggregation", args: [id] });
        if (now <= Number(g.guardianDeadline)) return { step: "guardian", tx: null, status, note: `guardian window open until ${g.guardianDeadline}` };
        const hash = await this.wallet(this.keeper).writeContract({ address: this.addr.DecisionEngine, abi: decisionEngineAbi, functionName: "finalizeEscalation", args: [id] });
        const { tx } = await this.confirm(hash, "DecisionEngine", "finalizeEscalation");
        return { step: "finalizeEscalation", tx, status: await this.status(decisionId) };
      }
      case "APPROVED": {
        const fork = forkFromIndex(
          await publicClient.readContract({ address: this.addr.DecisionEngine, abi: decisionEngineAbi, functionName: "approvedAction", args: [id] }),
        );
        if (fork === "ESCALATE") throw new Error("Unexpected ESCALATE approval");
        const r = await this.execute(decisionId, {
          decisionId,
          fork,
          definition: ACTION_SPACE[fork],
          approvedBy: "engine",
          params: null,
          execution: null,
        });
        return { step: "execute", tx: r.tx, status: "EXECUTED" };
      }
      case "EXECUTED": {
        const r = await this.resolve(decisionId);
        return { step: "resolve", tx: r.tx, status: "RESOLVED" };
      }
      default:
        return { step: "none", tx: null, status, note: "no further step" };
    }
  }

  /** Timing decisions follow the chain's clock (latest block), not the server's. */
  private async chainTime(): Promise<number> {
    return Number((await publicClient.getBlock({ blockTag: "latest" })).timestamp);
  }

  async status(decisionId: DecisionId): Promise<Status> {
    return statusFromIndex(
      await publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "statusOf", args: [BigInt(decisionId)] }),
    );
  }

  /** Agents' on-chain accuracy records, used as reputation in the local aggregation mirror. */
  async reputation(): Promise<ReputationRecords> {
    const count = await publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "agentCount" });
    const records: ReputationRecords["records"] = {};
    for (let i = 0; i < count; i++) {
      const a = await publicClient.readContract({ address: this.addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "getAgent", args: [i] });
      records[i] = { submitted: a.submitted, correct: a.correct };
    }
    return { source: "chain", records };
  }
}

