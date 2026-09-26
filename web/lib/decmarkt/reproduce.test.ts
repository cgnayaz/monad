import { describe, expect, it } from "vitest";
import { provenanceFixture } from "@/test/fixtures/provenance";
import { reproduce } from "./reproduce";

const params = { slashBps: 3000, missPenaltyBps: 1000 };

describe("Deterministic reproduction of outcome and settlement", () => {
  it("reproduces a consistent settlement exactly and explains every number", () => {
    const p = provenanceFixture();
    const r = reproduce(p, params)!;
    expect(r.matches).toBe(true);
    expect(r.outcome).toMatchObject({ correctFork: "DERISK", matches: true, moveBps: -20n });
    const wrong = r.lines.find((l) => l.result === "WRONG")!;
    expect(wrong.formula).toContain("slash 30 %");
    expect(wrong.formula).toContain("probability 70 %");
    const right = r.lines.find((l) => l.result === "CORRECT")!;
    expect(right.formula).toContain("probabilities of correct agents");
  });

  it("flags an on-chain settlement that does not follow the rule", () => {
    const p = provenanceFixture();
    p.settlement!.lines[0] = { ...p.settlement!.lines[0], reward: p.settlement!.lines[0].reward + 1n };
    const r = reproduce(p, params)!;
    expect(r.matches).toBe(false);
    expect(r.lines[0].matches).toBe(false);
  });

  it("flags a recorded outcome that does not follow from the prices", () => {
    const p = provenanceFixture();
    p.outcome = { ...p.outcome!, observedResult: { ...p.outcome!.observedResult!, correctFork: "DEPLOY" } };
    expect(reproduce(p, params)!.outcome!.matches).toBe(false);
  });

  it("does nothing before settlement", () => {
    const p = provenanceFixture();
    p.settlement = { ...p.settlement!, settlementStatus: "LOCKED" };
    expect(reproduce(p, params)).toBeNull();
  });
});
