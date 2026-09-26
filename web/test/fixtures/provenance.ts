/** TEST ONLY: a complete, internally consistent provenance built from the real Jev/DecMarkt functions. */
import { aggregate } from "@/lib/decmarkt/aggregate";
import { settle } from "@/lib/decmarkt/settlement";
import { resolveAction } from "@/lib/jev/action";
import { buildDecisionBatch } from "@/lib/jev/batch";
import { toAgentDecision } from "@/lib/jev/primitives";
import { assignedQuestions, buildQuestionSet } from "@/lib/jev/questions";
import { buildState } from "@/lib/jev/state";
import { buildOutcome, observe } from "@/lib/jev/verify";
import { AGENTS } from "@/lib/jev/agents";
import type { AgentRun, ParallelDecisions } from "@/lib/model/decision";
import type { DecisionProvenance } from "@/lib/model/provenance";
import type { AgentKey, Hex } from "@/lib/types/protocol";

const NOW = 1_790_000_000;
const BOND = 50_000_000_000_000_000n;
const TX = (n: number) => ({ chainId: 10143, hash: `0x${n.toString(16).padStart(64, "0")}` as Hex, blockNumber: BigInt(n), contract: "DecisionRegistry" as const, functionName: "x" });

/** Build a complete provenance end to end from Jev and DecMarkt functions (no chain). */
export function provenanceFixture(): DecisionProvenance {
  const state = buildState(
    { vault: null, asset: "MON", referenceFeed: "ETH/USD", horizonSec: 180, bandBps: 10 },
    [{ key: "market.ref.price", value: 0.0421, source: "pyth-hermes", observedAt: NOW, status: "ok" }],
    NOW,
  );
  const questions = buildQuestionSet(state, NOW);
  const decisionId = "1";

  const runs = Object.fromEntries(
    AGENTS.map((a) => {
      const decisions = assignedQuestions(questions, a.key).map((q) =>
        toAgentDecision({ decisionId, agentId: a.agentId, bond: BOND, timestamp: NOW + 10 }, q, {
          questionIndex: q.index,
          choice: a.key === "YIELD" ? "NO_ACTION" : "DERISK",
          probability: 7000,
          factors: q.rubric.map((f) => ({ factor: f.factor, rating: 3 as const, evidence: ["market.ref.price"] })),
          reason: "Downside move expected beyond the band within the horizon.",
        }),
      );
      const batch = buildDecisionBatch(state.stateId, decisions);
      const run: AgentRun = {
        decisionId,
        stateId: state.stateId,
        agentId: a.agentId,
        agentKey: a.key,
        provider: "test",
        model: "test",
        rubricVersion: "rubric/1",
        startedAt: 0,
        finishedAt: 0,
        rawOutputHash: null,
        status: "ok",
        failure: null,
        inputKeys: [],
        batch,
        final: batch.decisions.find((d) => d.questionIndex === 0)!,
      };
      return [a.key, run];
    }),
  ) as Record<AgentKey, AgentRun>;
  const parallel: ParallelDecisions = { decisionId, stateId: state.stateId, questionSetHash: questions.hash, runs };

  // On-chain: every answer of every batch is its own submission record.
  const submissions = Object.values(runs).flatMap((r) =>
    r.batch!.decisions.map((d) => ({
      decisionId,
      agentId: d.agentId,
      questionIndex: d.questionIndex,
      choice: d.choice,
      score: d.score,
      probability: d.probability,
      reasonHash: d.reasonHash,
      bond: BOND,
      submittedAt: NOW + 20,
    })),
  );
  const finals = submissions.filter((s) => s.questionIndex === 0);
  const aggregation = aggregate(
    decisionId,
    finals.map((s) => ({ ...s, agentSubmitted: 0, agentCorrect: 0 })),
    { thresholdBps: 6000, minActionScore: 5500, quorum: 4 },
  );
  const action = resolveAction(aggregation)!;
  action.execution = {
    amountMoved: 1n,
    after: { active: 9n, reserve: 1n },
    startPrice: { price: 10_000n, expo: -8, publishTime: NOW + 30 },
    executedAt: NOW + 30,
    tx: TX(5),
  };
  const outcome = buildOutcome({
    decisionId,
    expectedAction: action.fork,
    observed: observe(action.execution.startPrice, { price: 9_980n, expo: -8, publishTime: NOW + 210 }, 10),
    source: { kind: "simulation" },
    timestamp: NOW + 220,
    tx: TX(6),
  });
  const settlement = settle(
    decisionId,
    finals.map((s) => ({ agentId: s.agentId, bond: BOND, submission: { choice: s.choice, probability: s.probability } })),
    outcome.observedResult!.correctFork,
    { slashBps: 3000, missPenaltyBps: 1000, roundReward: 0n },
  );

  return {
    decision: {
      decisionId,
      status: "RESOLVED",
      stateHash: state.hash,
      questionsHash: questions.hash,
      proposer: "0x0000000000000000000000000000000000000001",
      config: { submissionWindow: 180, horizon: 180, bandBps: 10, thresholdBps: 6000, minActionScore: 5500, quorum: 4, allowedForks: 15, questionCount: 6, lockPerAgent: BOND },
      createdAt: NOW,
      openedAt: NOW,
      deadline: NOW + 180,
      participants: AGENTS.map((a) => a.agentId),
      roundReward: 0n,
      transitions: (["CREATED", "OPEN", "AGGREGATED", "APPROVED", "EXECUTED", "RESOLVED"] as const).map((status, i) => ({ status, blockNumber: BigInt(i + 1), tx: TX(i + 1) })),
    },
    state,
    questions,
    agents: AGENTS.map((a) => ({ agentId: a.agentId, key: a.key, name: a.name, operator: null })),
    submissions,
    parallel,
    aggregation,
    action,
    outcome,
    settlement,
  };
}

