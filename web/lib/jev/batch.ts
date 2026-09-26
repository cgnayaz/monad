import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { FORKS, type Hex } from "@/lib/types/protocol";
import type { JevAnswer } from "./primitives";

/**
 * Jev Batch Decisions (JEV_INTEGRATION.md §9).
 *
 * All answers of one agent in one decision form a batch, committed as a Merkle root.
 * Each leaf binds decision, agent, question and all four primitives, so provenance
 * survives aggregation. Uses OpenZeppelin's StandardMerkleTree (double-hashed leaves),
 * verifiable on-chain with OpenZeppelin MerkleProof.
 */

export const LEAF_ENCODING = ["uint256", "uint16", "uint8", "uint8", "uint16", "uint16", "bytes32"] as const;

export type LeafValues = [string, number, number, number, number, number, Hex];

export function leafValues(a: JevAnswer): LeafValues {
  return [a.decisionId, a.agentId, a.questionId, FORKS.indexOf(a.choice), a.score, a.probability, a.reasonHash];
}

export interface AgentBatch {
  answersRoot: Hex;
  leaves: { questionId: number; leafHash: Hex; proof: Hex[] }[];
}

export function buildAgentBatch(answers: readonly JevAnswer[]): AgentBatch {
  if (answers.length === 0) throw new Error("Empty batch");
  const agentIds = new Set(answers.map((a) => a.agentId));
  const decisionIds = new Set(answers.map((a) => a.decisionId));
  if (agentIds.size !== 1 || decisionIds.size !== 1) throw new Error("A batch belongs to one agent and one decision");

  const values = answers.map(leafValues);
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  const leaves = answers.map((a, i) => ({
    questionId: a.questionId,
    leafHash: tree.leafHash(values[i]) as Hex,
    proof: tree.getProof(i) as Hex[],
  }));
  return { answersRoot: tree.root as Hex, leaves };
}

export function verifyBatchLeaf(root: Hex, answer: JevAnswer, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, [...LEAF_ENCODING], leafValues(answer), proof);
}
