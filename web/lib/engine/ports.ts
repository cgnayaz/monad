import type { AgentSpec } from "@/lib/jev/agents";
import type { Action } from "@/lib/model/action";
import type { Aggregation } from "@/lib/model/aggregation";
import type { DecisionBatch } from "@/lib/model/decision";
import type { DecisionParameters } from "@/lib/model/final-decision";
import type { AgentId, DecisionId, UnixSeconds } from "@/lib/model/primitives";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import type { TxRef } from "@/lib/model/transaction";
import type { Status } from "@/lib/types/protocol";

/**
 * The DecMarkt execution layer as seen by the decision pipeline. The pipeline hands it
 * hashes, validated batches and the bounded Action; the implementation
 * (lib/chain/execution-layer.ts) turns them into calls to fixed contract functions.
 * Nothing the AI produced reaches this interface except validated enum values, integers
 * in range and reason hashes.
 */
export interface CommitResult {
  decisionId: DecisionId;
  participants: AgentId[];
  deadline: UnixSeconds;
  txs: TxRef[];
}

export interface ExecutionLayer {
  /** createDecision + openDecision: commit state and question hashes before any agent runs. */
  commit(state: StateRecord, questions: QuestionSet, params: DecisionParameters): Promise<CommitResult>;
  /** submitBatch from the agent's own operator key. */
  submitBatch(decisionId: DecisionId, agent: AgentSpec, batch: DecisionBatch): Promise<TxRef>;
  /** DecisionEngine.aggregate; returns the resulting on-chain status. */
  aggregate(decisionId: DecisionId): Promise<{ tx: TxRef; status: Status }>;
  /** DecisionEngine.getAggregation, mapped to the domain model. */
  readAggregation(decisionId: DecisionId): Promise<Aggregation>;
  /** ExecutionVault.execute — refuses if `action.fork` differs from the on-chain approved action. */
  execute(decisionId: DecisionId, action: Action): Promise<{ tx: TxRef; executedAt: UnixSeconds }>;
}

export interface ReputationRecords {
  source: "chain" | "none-recorded";
  records: Record<AgentId, { submitted: number; correct: number }>;
}
