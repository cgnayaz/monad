import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { FORKS, type Hex } from "@/lib/types/protocol";
import type { AgentDecision, DecisionBatch } from "@/lib/model/decision";
import type { StateId } from "@/lib/model/state";

/**
 * Jev Batch Decisions (JEV_INTEGRATION.md §9).
 *
 * All of one agent's decisions in one round form a batch, committed as a Merkle root.
 * Each leaf binds decision, agent, question slot and all primitives, so question-level
 * provenance survives aggregation. OpenZeppelin StandardMerkleTree (double-hashed leaves),
 * verifiable on-chain with OpenZeppelin MerkleProof.
 */

export const LEAF_ENCODING = ["uint256", "uint16", "uint8", "uint8", "uint16", "uint16", "bytes32"] as const;

export type LeafValues = [string, number, number, number, number, number, Hex];

export function leafValues(d: AgentDecision): LeafValues {
  return [d.decisionId, d.agentId, d.questionIndex, FORKS.indexOf(d.choice), d.score, d.probability, d.reasonHash];
}

export function buildDecisionBatch(stateId: StateId, decisions: readonly AgentDecision[]): DecisionBatch {
  if (decisions.length === 0) throw new Error("Empty batch");
  const agentIds = new Set(decisions.map((d) => d.agentId));
  const decisionIds = new Set(decisions.map((d) => d.decisionId));
  if (agentIds.size !== 1 || decisionIds.size !== 1) throw new Error("A batch belongs to one agent and one decision");
  if (new Set(decisions.map((d) => d.questionId)).size !== decisions.length) throw new Error("Duplicate question in batch");

  const sorted = [...decisions].sort((a, b) => a.questionIndex - b.questionIndex);
  const values = sorted.map(leafValues);
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  const { decisionId, agentId } = sorted[0];
  return {
    batchId: `bt_${decisionId}_${agentId}`,
    decisionId,
    stateId,
    agentId,
    decisions: sorted,
    answersRoot: tree.root as Hex,
    leaves: sorted.map((d, i) => ({
      questionId: d.questionId,
      questionIndex: d.questionIndex,
      leafHash: tree.leafHash(values[i]) as Hex,
      proof: tree.getProof(i) as Hex[],
    })),
  };
}

export function verifyBatchLeaf(root: Hex, decision: AgentDecision, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, [...LEAF_ENCODING], leafValues(decision), proof);
}
