import { describe, expect, it } from "vitest";
import { AGENTS } from "@/lib/jev/agents";
import { provenanceFixture as fixture } from "@/test/fixtures/provenance";
import type { DecisionProvenance } from "./provenance";
import { PROVENANCE_STAGES, traceDecision, validateProvenance } from "./provenance";

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
