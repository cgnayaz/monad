import { describe, expect, it } from "vitest";
import { aggregate } from "@/lib/decmarkt/aggregate";
import { settle } from "@/lib/decmarkt/settlement";
import { resolveAction } from "@/lib/jev/action";
import { buildDecisionBatch } from "@/lib/jev/batch";
import { toAgentDecision } from "@/lib/jev/primitives";
import { assignedQuestions, buildQuestionSet } from "@/lib/jev/questions";
import { buildState } from "@/lib/jev/state";
import { buildOutcome, observe } from "@/lib/jev/verify";
import { AGENTS } from "@/lib/jev/agents";
import type { AgentRun, ParallelDecisions } from "./decision";
import type { DecisionProvenance } from "./provenance";
import { PROVENANCE_STAGES, traceDecision, validateProvenance } from "./provenance";
import type { AgentKey, Hex } from "@/lib/types/protocol";

const NOW = 1_790_000_000;
const BOND = 50_000_000_000_000_000n;
const TX = (n: number) => ({ chainId: 10143, hash: `0x${n.toString(16).padStart(64, "0")}` as Hex, blockNumber: BigInt(n), contract: "DecisionRegistry" as const, functionName: "x" });

/** Build a complete provenance end to end from Jev and DecMarkt functions (no chain). */
function fixture(): DecisionProvenance {
  const state = buildState(
    { vault: null, asset: "MON", referenceFeed: "MON/USD", horizonSec: 180, bandBps: 10 },
    [{ key: "market.mon_usd.price", value: 0.0421, source: "pyth-hermes", observedAt: NOW, status: "ok" }],
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
          factors: q.rubric.map((f) => ({ factor: f.factor, rating: 3 as const, evidence: ["market.mon_usd.price"] })),
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
    source: { kind: "preview" },
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

describe("Provenance", () => {
  it("reconstructs State → … → Settlement for every agent", () => {
    const p = fixture();
    expect(validateProvenance(p)).toEqual([]);
    for (const a of AGENTS) {
      const steps = traceDecision(p, a.agentId);
      expect(steps.map((s) => s.stage)).toEqual([...PROVENANCE_STAGES]);
      expect(steps.every((s) => s.status === "present")).toBe(true);
    }
    const risk = traceDecision(p, 0);
    expect(risk[1].ref).toContain("[ACTION]");
    expect(risk[8].ref).toContain("CORRECT");
    expect(traceDecision(p, 1)[8].ref).toContain("WRONG");
  });

  it("flags a tampered non-final answer and duplicate answers", () => {
    const p = fixture();
    const i = p.submissions.findIndex((s) => s.questionIndex !== 0);
    p.submissions[i] = { ...p.submissions[i], probability: 9900 as typeof p.submissions[number]["probability"] };
    expect(validateProvenance(p).some((x) => x.includes(`answer to question ${p.submissions[i].questionIndex} differs`))).toBe(true);
    const q = fixture();
    q.submissions.push({ ...q.submissions[0] });
    expect(validateProvenance(q).some((x) => x.startsWith("duplicate answer"))).toBe(true);
  });

  it("flags a broken link", () => {
    const p = fixture();
    const i = p.submissions.findIndex((s) => s.questionIndex === 0);
    p.submissions[i] = { ...p.submissions[i], choice: "DEPLOY" };
    expect(validateProvenance(p).some((i) => i.includes("final decision differs from chain"))).toBe(true);

    const q = fixture();
    q.outcome = { ...q.outcome!, expectedAction: "DEPLOY" };
    expect(validateProvenance(q).some((i) => i.includes("expectedAction"))).toBe(true);

    const r = fixture();
    r.questions = { hash: `0x${"0".repeat(64)}` };
    expect(validateProvenance(r)).toContain("question set hash differs from Decision.questionsHash");
  });

  it("marks off-chain links as reference-only when only hashes are known", () => {
    const p = fixture();
    const refOnly: DecisionProvenance = { ...p, state: { stateId: null, hash: p.decision.stateHash }, questions: { hash: p.decision.questionsHash }, parallel: null };
    expect(validateProvenance(refOnly)).toEqual([]);
    const steps = traceDecision(refOnly, 0);
    expect(steps[0].status).toBe("reference-only");
    expect(steps[1].status).toBe("reference-only");
    expect(steps[3].status).toBe("present"); // on-chain submission still traceable
  });
});
