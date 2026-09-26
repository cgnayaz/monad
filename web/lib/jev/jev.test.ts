import { describe, expect, it } from "vitest";
import { aggregate } from "@/lib/decmarkt/aggregate";
import { release, settle, type SettlementParticipant } from "@/lib/decmarkt/settlement";
import { toProbability, toScore } from "@/lib/model/primitives";
import { validateModelOutput } from "@/lib/validation/model-output";
import { FORKS, type Fork } from "@/lib/types/protocol";
import { previewAction, resolveAction } from "./action";
import { buildDecisionBatch, verifyBatchLeaf } from "./batch";
import { forkSpace, forksToMask, maskToForks, parseFork } from "./forks";
import { toAgentDecision } from "./primitives";
import { assignedQuestions, buildQuestionSet, questionByIndex, QUESTION_TEMPLATES, relevantInputKeys } from "./questions";
import { computeScore } from "./score";
import { buildState, computeStateHash, sliceState, type StateInput } from "./state";
import { buildOutcome, checkQuestionSet, checkState, correctFork, moveBps, observe } from "./verify";

const NOW = 1_790_000_000;
const inputs: StateInput[] = [
  { key: "market.mon_usd.price", value: 0.0421, unit: "USD", source: "pyth-hermes", observedAt: NOW, status: "ok" },
  { key: "network.block_number", value: "123", source: "monad-rpc", observedAt: NOW, status: "ok" },
  { key: "vault.active", value: null, unit: "MON", source: "execution-vault", observedAt: NOW, status: "unavailable", note: "contracts not deployed" },
];
const subject = { vault: null, asset: "MON", referenceFeed: "MON/USD", horizonSec: 180, bandBps: 10 } as const;
const BOND = 50_000_000_000_000_000n;

describe("Jev State", () => {
  it("has id, version, sources, timestamp, data and a deterministic hash", () => {
    const a = buildState(subject, inputs, NOW);
    const b = buildState(subject, [...inputs].reverse(), NOW);
    expect(a.hash).toBe(b.hash);
    expect(a.stateId).toMatch(/^st_[0-9a-f]{16}$/);
    expect(a.version).toBe("decmarkt.jev.state/1");
    expect(a.source).toEqual(["execution-vault", "monad-rpc", "pyth-hermes"]);
    expect(a.timestamp).toBe(NOW);
    expect(computeStateHash(a)).toBe(a.hash);
  });
  it("rejects an ok input without a value", () => {
    expect(() => buildState(subject, [{ ...inputs[0], value: null }], NOW)).toThrow();
  });
  it("detects tampering", () => {
    const s = buildState(subject, inputs, NOW);
    expect(checkState(s.hash, s).status).toBe("VERIFIED");
    expect(checkState(s.hash, { ...s, timestamp: NOW + 1 }).status).toBe("MISMATCH");
    expect(checkState(s.hash, null).status).toBe("UNAVAILABLE");
  });
});

describe("Jev Questions", () => {
  const state = buildState(subject, inputs, NOW);
  const set = buildQuestionSet(state, NOW);
  it("gives every question its own id bound to the state", () => {
    const ids = set.questions.map((q) => q.questionId);
    expect(new Set(ids).size).toBe(QUESTION_TEMPLATES.length);
    for (const q of set.questions) {
      expect(q.questionId).toMatch(/^qn_[0-9a-f]{16}$/);
      expect(q.stateId).toBe(state.stateId);
      expect(q.createdAt).toBe(NOW);
    }
    const other = buildQuestionSet(buildState(subject, inputs, NOW + 5), NOW);
    expect(other.questions[0].questionId).not.toBe(set.questions[0].questionId);
    expect(checkQuestionSet(set.hash, set).status).toBe("VERIFIED");
  });
  it("assigns each agent its primary question plus ACTION", () => {
    expect(assignedQuestions(set, "RISK").map((q) => q.category)).toEqual(["RISK", "ACTION"]);
  });
});

describe("Jev primitives", () => {
  it("rejects out-of-range scores and probabilities", () => {
    expect(() => toScore(10_001)).toThrow();
    expect(() => toScore(1.5)).toThrow();
    expect(() => toProbability(99)).toThrow();
    expect(() => toProbability(9_901)).toThrow();
    expect(toProbability(5000)).toBe(5000);
  });
  it("computes the score as a weighted integer average", () => {
    const rubric = QUESTION_TEMPLATES[0].rubric; // weights 3,2,1
    expect(computeScore(rubric, { evidence_strength: 4, evidence_agreement: 4, data_completeness: 4 })).toBe(10_000);
    expect(computeScore(rubric, { evidence_strength: 3, evidence_agreement: 2, data_completeness: 1 })).toBe(5833);
    expect(() => computeScore(rubric, { evidence_strength: 3 })).toThrow();
  });
});

describe("Bounded forks", () => {
  it("round-trips masks, requires NO_ACTION, rejects unknown labels", () => {
    expect(maskToForks(forksToMask(["NO_ACTION", "DEPLOY"]))).toEqual(["NO_ACTION", "DEPLOY"]);
    expect(forkSpace(["DEPLOY", "NO_ACTION"]).allowed).toEqual(["NO_ACTION", "DEPLOY"]);
    expect(() => forkSpace(["DEPLOY"])).toThrow();
    expect(parseFork("TRANSFER_ALL")).toBeNull();
  });
});

describe("Model output validation", () => {
  const state = buildState(subject, inputs, NOW);
  const set = buildQuestionSet(state, NOW);
  const assigned = assignedQuestions(set, "RISK");
  const answer = (questionIndex: number, evidence = ["market.mon_usd.price"]) => ({
    questionIndex,
    choice: "NO_ACTION",
    probability: 5500,
    factors: questionByIndex(set, questionIndex).rubric.map((f) => ({ factor: f.factor, rating: 2, evidence })),
    reason: "Price is inside the band and no input suggests a directional move.",
  });
  const slice = sliceState(state, relevantInputKeys(assigned));
  const check = (answers: unknown[]) => validateModelOutput({ answers }, { state: slice, assigned }).ok;

  it("accepts a well-formed batch", () => expect(check([answer(1), answer(0)])).toBe(true));
  it("rejects invented evidence, extra questions, bad ranges, unknown forks and calldata", () => {
    expect(check([answer(1, ["made.up"]), answer(0)])).toBe(false);
    expect(check([answer(1), answer(0), answer(2)])).toBe(false);
    expect(check([{ ...answer(1), probability: 10_000 }, answer(0)])).toBe(false);
    expect(check([{ ...answer(1), choice: "SEND_FUNDS" }, answer(0)])).toBe(false);
    expect(check([{ ...answer(1), calldata: "0xdeadbeef" }, answer(0)])).toBe(false);
  });
});

function makeBatch(decisionId = "7", agentId = 2, choice: Fork = "DERISK") {
  const state = buildState(subject, inputs, NOW);
  const set = buildQuestionSet(state, NOW);
  const decisions = assignedQuestions(set, "SECURITY").map((q) =>
    toAgentDecision({ decisionId, agentId, bond: BOND, timestamp: NOW }, q, {
      questionIndex: q.index,
      choice,
      probability: 6200,
      factors: q.rubric.map((f) => ({ factor: f.factor, rating: 3 as const, evidence: [] })),
      reason: "Short-term change is negative and beyond the band.",
    }),
  );
  return { state, set, batch: buildDecisionBatch(state.stateId, decisions) };
}

describe("Agent decisions and batches", () => {
  it("carries every required field", () => {
    const { batch, set } = makeBatch();
    const d = batch.decisions[0];
    expect(d).toMatchObject({ agentId: 2, decisionId: "7", bond: BOND, timestamp: NOW, choice: "DERISK", probability: 6200 });
    expect(set.questions.some((q) => q.questionId === d.questionId)).toBe(true);
    expect(d.score).toBe(7500);
  });
  it("preserves question-level provenance per leaf", () => {
    const { batch } = makeBatch();
    expect(batch.batchId).toBe("bt_7_2");
    expect(batch.leaves.map((l) => l.questionIndex)).toEqual([0, 3]);
    batch.decisions.forEach((d, i) => expect(verifyBatchLeaf(batch.answersRoot, d, batch.leaves[i].proof)).toBe(true));
    expect(verifyBatchLeaf(batch.answersRoot, { ...batch.decisions[0], probability: toProbability(9900) }, batch.leaves[0].proof)).toBe(false);
  });
  it("refuses a batch mixing agents or repeating a question", () => {
    const a = makeBatch("7", 1).batch.decisions;
    const b = makeBatch("7", 2).batch.decisions;
    expect(() => buildDecisionBatch(makeBatch().state.stateId, [...a, ...b])).toThrow();
    expect(() => buildDecisionBatch(makeBatch().state.stateId, [a[0], a[0]])).toThrow();
  });
});

describe("Verify", () => {
  it("classifies moves against the band and builds an outcome", () => {
    expect(moveBps(10_000n, 10_020n)).toBe(20n);
    expect(correctFork(10_000n, 9_980n, 10)).toBe("DERISK");
    expect(correctFork(10_000n, 10_010n, 10)).toBe("NO_ACTION");
    const observed = observe({ price: 10_000n, expo: -8, publishTime: NOW }, { price: 10_020n, expo: -8, publishTime: NOW + 180 }, 10);
    const o = buildOutcome({ decisionId: "7", expectedAction: "DEPLOY", observed, source: { kind: "simulation" }, timestamp: NOW + 200, tx: null });
    expect(o).toMatchObject({ expectedAction: "DEPLOY", success: true, status: "VERIFIED" });
    expect(buildOutcome({ decisionId: "7", expectedAction: "DEPLOY", observed: null, source: { kind: "simulation" }, timestamp: NOW, tx: null }).status).toBe("VOID");
  });
});

describe("Action", () => {
  it("is bounded by actionBps and maxMove", () => {
    const p = previewAction("DERISK", { active: 10_000n, reserve: 0n }, { actionBps: 1000, maxMove: 500n });
    expect(p.amount).toBe(500n);
    expect(p.after).toEqual({ active: 9_500n, reserve: 500n });
  });
});

describe("DecMarkt aggregation", () => {
  const cfg = { thresholdBps: 6000, minActionScore: 5500, quorum: 4 };
  const subs = (choices: Fork[], score = 7000) =>
    choices.map((choice, agentId) => ({ agentId, choice, score: toScore(score), probability: toProbability(7000), agentSubmitted: 0, agentCorrect: 0 }));

  it("approves a clear majority and records each contribution", () => {
    const r = aggregate("1", subs(["DERISK", "DERISK", "DERISK", "NO_ACTION", "DERISK"]), cfg);
    expect(r.approved).toBe("DERISK");
    expect(r.inputs).toHaveLength(5);
    expect(r.inputs[0].weight).toBe(3500n); // 7000 × 50 %
    expect(resolveAction(r)?.approvedBy).toBe("engine");
  });
  it("falls back to NO_ACTION when the threshold fails", () => {
    const r = aggregate("1", subs(["DERISK", "DERISK", "DEPLOY", "DEPLOY", "NO_ACTION"]), cfg);
    expect(r.approved).toBe("NO_ACTION");
    expect(resolveAction(r)?.approvedBy).toBe("fail-safe");
  });
  it("gates actions on minimum score and fails quorum", () => {
    expect(aggregate("1", subs(["DEPLOY", "DEPLOY", "DEPLOY", "DEPLOY"], 4000), cfg).gates?.score).toBe(false);
    expect(aggregate("1", subs(["DERISK", "DERISK", "DERISK"]), cfg).gates?.quorum).toBe(false);
  });
  it("waits for a guardian when ESCALATE wins", () => {
    const r = aggregate("1", subs(["ESCALATE", "ESCALATE", "ESCALATE", "ESCALATE"]), cfg);
    expect(r.approved).toBeNull();
    expect(resolveAction(r)).toBeNull();
    expect(resolveAction(r, { fork: "DERISK", timedOut: false })?.approvedBy).toBe("guardian");
    expect(resolveAction(r, { fork: null, timedOut: true })?.fork).toBe("NO_ACTION");
  });
  it("refuses two submissions from one agent", () => {
    const s = subs(["DERISK", "DERISK", "DERISK", "DERISK"]);
    expect(() => aggregate("1", [...s, s[0]], cfg)).toThrow();
  });
});

describe("DecMarkt settlement", () => {
  const params = { slashBps: 3000, missPenaltyBps: 1000, roundReward: 20_000_000_000_000_000n };
  it("conserves value for every combination of outcome and choices", () => {
    const choices: (Fork | null)[] = [...FORKS, null];
    for (const correct of ["NO_ACTION", "DERISK", "DEPLOY"] as const) {
      for (let seed = 0; seed < 200; seed++) {
        const participants: SettlementParticipant[] = [0, 1, 2, 3, 4].map((agentId) => {
          const c = choices[(seed * 7 + agentId * 3) % choices.length];
          return { agentId, bond: BOND, submission: c ? { choice: c, probability: toProbability(100 + ((seed * 131 + agentId * 977) % 9801)) } : null };
        });
        const s = settle("1", participants, correct, params);
        const paidOut = s.lines.reduce((t, l) => t + l.bond + l.net, 0n);
        expect(paidOut + s.toRewardPool).toBe(BOND * 5n + params.roundReward);
        for (const l of s.lines) {
          expect(l.settlementStatus).toBe("SETTLED");
          expect(l.net).toBe(l.reward - l.penalty);
          if (l.result === "WRONG") expect(l.penalty).toBeLessThanOrEqual((BOND * 3000n) / 10_000n);
          if (l.result !== "CORRECT") expect(l.reward).toBe(0n);
        }
      }
    }
  });
  it("releases bonds in full on cancel", () => {
    const r = release("1", [{ agentId: 0, bond: BOND, submission: null }], params.roundReward, "RELEASED");
    expect(r.lines[0]).toMatchObject({ settlementStatus: "RELEASED", penalty: 0n, reward: 0n, net: 0n, result: null });
  });
});
