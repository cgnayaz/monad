import { describe, expect, it } from "vitest";
import { aggregate } from "@/lib/decmarkt/aggregate";
import { settle, type SettlementParticipant } from "@/lib/decmarkt/settlement";
import { validateModelOutput } from "@/lib/validation/model-output";
import { FORKS, type Fork } from "@/lib/types/protocol";
import { previewAction } from "./action";
import { buildAgentBatch, verifyBatchLeaf } from "./batch";
import { buildState, stateHash, type StateInput } from "./state";
import { buildQuestionSet, QUESTIONS } from "./questions";
import { computeScore } from "./score";
import { toJevAnswer } from "./primitives";
import { correctFork, moveBps, checkPayloadHash } from "./verify";
import { forksToMask, maskToForks, parseFork } from "./forks";

const NOW = 1_790_000_000;
const inputs: StateInput[] = [
  { key: "market.mon_usd.price", value: 0.0421, unit: "USD", source: "pyth-hermes", observedAt: NOW, status: "ok" },
  { key: "network.block_number", value: "123", source: "monad-rpc", observedAt: NOW, status: "ok" },
  { key: "vault.active", value: null, unit: "MON", source: "execution-vault", observedAt: NOW, status: "unavailable", note: "contracts not deployed" },
];
const subject = { vault: null, asset: "MON", referenceFeed: "MON/USD", horizonSec: 180, bandBps: 10 } as const;

describe("Jev State", () => {
  it("hashes deterministically regardless of input order", () => {
    const a = buildState(subject, inputs, NOW);
    const b = buildState(subject, [...inputs].reverse(), NOW);
    expect(a.stateHash).toBe(b.stateHash);
    expect(stateHash(a.state)).toBe(a.stateHash);
    expect(a.state.stateId).toMatch(/^st_[0-9a-f]{16}$/);
  });
  it("rejects an ok input without a value", () => {
    expect(() => buildState(subject, [{ ...inputs[0], value: null }], NOW)).toThrow();
  });
  it("detects payload tampering", () => {
    const { state, stateHash: h } = buildState(subject, inputs, NOW);
    expect(checkPayloadHash("state", h, state).status).toBe("VERIFIED");
    const tampered = { ...state, observedAt: NOW + 1 };
    expect(checkPayloadHash("state", h, tampered).status).toBe("MISMATCH");
    expect(checkPayloadHash("state", h, null).status).toBe("UNAVAILABLE");
  });
});

describe("Jev Score", () => {
  const rubric = QUESTIONS[0].rubric; // weights 3,2,1
  it("maps all-max to 10000 and all-zero to 0", () => {
    expect(computeScore(rubric, { evidence_strength: 4, evidence_agreement: 4, data_completeness: 4 })).toBe(10_000);
    expect(computeScore(rubric, { evidence_strength: 0, evidence_agreement: 0, data_completeness: 0 })).toBe(0);
  });
  it("is a weighted integer average", () => {
    // (3·3 + 2·2 + 1·1) / (4·6) = 14/24 → 5833.33 → 5833
    expect(computeScore(rubric, { evidence_strength: 3, evidence_agreement: 2, data_completeness: 1 })).toBe(5833);
  });
  it("requires every factor", () => {
    expect(() => computeScore(rubric, { evidence_strength: 3 })).toThrow();
  });
});

describe("Bounded Forks", () => {
  it("round-trips masks and rejects unknown labels", () => {
    expect(maskToForks(forksToMask(["NO_ACTION", "DEPLOY"]))).toEqual(["NO_ACTION", "DEPLOY"]);
    expect(parseFork("DERISK")).toBe("DERISK");
    expect(parseFork("TRANSFER_ALL")).toBeNull();
  });
});

describe("Model output validation", () => {
  const { state } = buildState(subject, inputs, NOW);
  const { questionSet } = buildQuestionSet();
  const answer = (questionId: number, evidence = ["market.mon_usd.price"]) => ({
    questionId,
    choice: "NO_ACTION",
    probability: 5500,
    factors: questionSet.questions[questionId].rubric.map((f) => ({ factor: f.factor, rating: 2, evidence })),
    reason: "Price is inside the band and no input suggests a directional move.",
  });

  it("accepts a well-formed batch", () => {
    const v = validateModelOutput({ answers: [answer(1), answer(0)] }, { state, questionSet, assigned: [1, 0] });
    expect(v.ok).toBe(true);
  });
  it("rejects invented evidence, extra questions and out-of-range probability", () => {
    expect(validateModelOutput({ answers: [answer(1, ["made.up"]), answer(0)] }, { state, questionSet, assigned: [1, 0] }).ok).toBe(false);
    expect(validateModelOutput({ answers: [answer(1), answer(0), answer(2)] }, { state, questionSet, assigned: [1, 0] }).ok).toBe(false);
    expect(validateModelOutput({ answers: [{ ...answer(1), probability: 10_000 }, answer(0)] }, { state, questionSet, assigned: [1, 0] }).ok).toBe(false);
    expect(validateModelOutput({ answers: [{ ...answer(1), choice: "SEND_FUNDS" }, answer(0)] }, { state, questionSet, assigned: [1, 0] }).ok).toBe(false);
    expect(validateModelOutput({ answers: [{ ...answer(1), calldata: "0xdeadbeef" }, answer(0)] }, { state, questionSet, assigned: [1, 0] }).ok).toBe(false);
  });
});

describe("Jev Batch", () => {
  it("builds a root and verifies each leaf", () => {
    const { questionSet } = buildQuestionSet();
    const answers = [1, 0].map((qid) =>
      toJevAnswer("7", 2, questionSet.questions[qid], {
        questionId: qid,
        choice: "DERISK",
        probability: 6200,
        factors: questionSet.questions[qid].rubric.map((f) => ({ factor: f.factor, rating: 3 as const, evidence: [] })),
        reason: "Short-term change is negative and beyond the band.",
      }),
    );
    const batch = buildAgentBatch(answers);
    answers.forEach((a, i) => expect(verifyBatchLeaf(batch.answersRoot, a, batch.leaves[i].proof)).toBe(true));
    const forged = { ...answers[0], probability: 9900 };
    expect(verifyBatchLeaf(batch.answersRoot, forged, batch.leaves[0].proof)).toBe(false);
  });
});

describe("Verify", () => {
  it("classifies moves against the band", () => {
    expect(moveBps(10_000n, 10_020n)).toBe(20n);
    expect(correctFork(10_000n, 10_020n, 10)).toBe("DEPLOY");
    expect(correctFork(10_000n, 9_980n, 10)).toBe("DERISK");
    expect(correctFork(10_000n, 10_010n, 10)).toBe("NO_ACTION");
  });
});

describe("Action", () => {
  it("is bounded by actionBps and maxMove", () => {
    const p = previewAction("DERISK", { active: 10_000n, reserve: 0n }, { actionBps: 1000, maxMove: 500n });
    expect(p.amount).toBe(500n);
    expect(p.after).toEqual({ active: 9_500n, reserve: 500n });
    expect(previewAction("ESCALATE", { active: 1n, reserve: 1n }, { actionBps: 1000, maxMove: 1n }).requiresGuardian).toBe(true);
  });
});

describe("DecMarkt aggregation", () => {
  const cfg = { thresholdBps: 6000, minActionScore: 5500, quorum: 4 };
  const sub = (choice: Fork, probability = 7000, score = 7000) => ({ choice, probability, score, agentSubmitted: 0, agentCorrect: 0 });

  it("approves a clear majority", () => {
    const r = aggregate([sub("DERISK"), sub("DERISK"), sub("DERISK"), sub("NO_ACTION"), sub("DERISK")], cfg);
    expect(r.passed).toBe(true);
    expect(r.approved).toBe("DERISK");
  });
  it("falls back to NO_ACTION when threshold fails", () => {
    const r = aggregate([sub("DERISK"), sub("DERISK"), sub("DEPLOY"), sub("DEPLOY"), sub("NO_ACTION")], cfg);
    expect(r.passed).toBe(false);
    expect(r.approved).toBe("NO_ACTION");
  });
  it("gates actions on minimum score", () => {
    const r = aggregate([sub("DEPLOY", 7000, 4000), sub("DEPLOY", 7000, 4000), sub("DEPLOY", 7000, 4000), sub("DEPLOY", 7000, 4000)], cfg);
    expect(r.gates.score).toBe(false);
    expect(r.approved).toBe("NO_ACTION");
  });
  it("requires a guardian when ESCALATE wins", () => {
    const r = aggregate([sub("ESCALATE"), sub("ESCALATE"), sub("ESCALATE"), sub("ESCALATE")], cfg);
    expect(r.guardianRequired).toBe(true);
    expect(r.approved).toBeNull();
  });
  it("fails quorum", () => {
    expect(aggregate([sub("DERISK"), sub("DERISK"), sub("DERISK")], cfg).gates.quorum).toBe(false);
  });
});

describe("DecMarkt settlement", () => {
  it("conserves value for every combination of outcome and choices", () => {
    const params = { slashBps: 3000, missPenaltyBps: 1000, roundReward: 20_000_000_000_000_000n };
    const lock = 50_000_000_000_000_000n;
    const choices: (Fork | null)[] = [...FORKS, null];
    for (const correct of ["NO_ACTION", "DERISK", "DEPLOY"] as Fork[]) {
      for (let seed = 0; seed < 200; seed++) {
        const participants: SettlementParticipant[] = [0, 1, 2, 3, 4].map((agentId) => {
          const c = choices[(seed * 7 + agentId * 3) % choices.length];
          return { agentId, lock, submission: c ? { choice: c, probability: 100 + ((seed * 131 + agentId * 977) % 9801) } : null };
        });
        const { lines, toRewardPool } = settle(participants, correct, params);
        const locks = lock * 5n;
        const released = lines.reduce((t, l) => t + l.lockReleased - l.penalty + l.reward, 0n);
        expect(released + toRewardPool).toBe(locks + params.roundReward);
        for (const l of lines) {
          if (l.result === "WRONG") expect(l.penalty).toBeLessThanOrEqual((lock * 3000n) / 10_000n);
          if (l.result !== "CORRECT") expect(l.reward).toBe(0n);
        }
      }
    }
  });
});
