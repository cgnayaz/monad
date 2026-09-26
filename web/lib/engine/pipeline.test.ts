import { describe, expect, it } from "vitest";
import { ProviderError, type DecisionProvider } from "@/lib/ai/provider";
import { ScriptedProvider, type Script } from "@/test/fixtures/scripted-provider";
import { AGENTS } from "@/lib/jev/agents";
import { buildState } from "@/lib/jev/state";
import type { Action } from "@/lib/model/action";
import type { Aggregation } from "@/lib/model/aggregation";
import type { DecisionBatch } from "@/lib/model/decision";
import type { PipelineEvent } from "@/lib/model/final-decision";
import type { TxRef } from "@/lib/model/transaction";
import { FORKS, type AgentKey, type Hex, type Status } from "@/lib/types/protocol";
import { runDecisionPipeline, type PipelineDeps } from "./pipeline";
import type { ExecutionLayer } from "./ports";

const NOW = 1_790_000_000;
const PARAMS = {
  submissionWindow: 180,
  horizon: 180,
  bandBps: 10,
  thresholdBps: 6000,
  minActionScore: 5500,
  quorum: 4,
  allowedForks: [...FORKS],
  lockPerAgent: 50_000_000_000_000_000n,
};

const state = () =>
  Promise.resolve(
    buildState(
      { vault: null, asset: "MON", referenceFeed: "ETH/USD", horizonSec: 180, bandBps: 10 },
      [
        { key: "market.ref.price", value: 0.0421, unit: "USD", source: "pyth-hermes", observedAt: NOW, status: "ok" },
        { key: "network.block_number", value: "123", source: "monad-rpc", observedAt: NOW, status: "ok" },
        { key: "history.ref.change_1h", value: -35, unit: "bps", source: "pyth-hermes", observedAt: NOW, status: "ok" },
        { key: "vault.active", value: null, unit: "MON", source: "execution-vault", observedAt: NOW, status: "unavailable", note: "not deployed" },
      ],
      NOW,
    ),
  );

const deps = (provider: DecisionProvider, execution: ExecutionLayer | null = null, timeoutMs = 2_000): PipelineDeps => ({
  collectState: state,
  provider,
  agents: AGENTS,
  params: PARAMS,
  reputation: { source: "none-recorded", records: {} },
  execution,
  simulationReason: execution ? undefined : "test simulation",
  agentTimeoutMs: timeoutMs,
  now: () => NOW,
});

describe("Decision pipeline — preview", () => {
  it("runs STATE → QUESTIONS → PARALLEL → AGGREGATION → ACTION and builds the final object", async () => {
    const events: PipelineEvent[] = [];
    const d = await runDecisionPipeline(deps(new ScriptedProvider({ YIELD: { kind: "answer", choice: "NO_ACTION" } })), (e) => events.push(e));

    expect(d.mode).toBe("simulation");
    expect(d.decisionId).toBe("0");
    expect(d.state.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d.questions.questions).toHaveLength(6);
    expect(d.agentDecisions).toHaveLength(10); // 5 agents × (primary + ACTION)
    expect(new Set(d.agentDecisions.map((a) => `${a.agentId}:${a.questionId}`)).size).toBe(10);
    expect(d.agents.every((a) => a.status === "ok")).toBe(true);

    // Deterministic aggregation: 4 × DERISK (w 3500), 1 × NO_ACTION (w 3500).
    expect(d.aggregation.support.DERISK).toBe(14_000n);
    expect(d.selectedChoice).toBe("DERISK");
    expect(d.threshold).toMatchObject({ thresholdBps: 6000, supportShareBps: 8000, passed: true });
    expect(d.aggregateScore).toBe(7500);
    expect(d.aggregateProbability).toBe(7000);
    expect(d.action).toMatchObject({ fork: "DERISK", approvedBy: "engine" });
    expect(d.action).not.toHaveProperty("calldata");
    expect(d.execution).toEqual({ status: "not-submitted", reason: "test simulation" });

    const stages = events.filter((e) => e.type === "stage").map((e) => `${e.stage}:${e.status}`);
    expect(stages).toContain("COMMIT:skipped");
    expect(stages.at(-1)).toBe("EXECUTION:skipped");
    expect(events.filter((e) => e.type === "agent")).toHaveLength(5);
    expect(events.at(-1)?.type).toBe("result");
  });

  it("gives each agent only the state relevant to its questions", async () => {
    const provider = new ScriptedProvider({});
    await runDecisionPipeline(deps(provider));
    const security = provider.seen.find((r) => r.agent.key === "SECURITY")!;
    expect(security.questions.map((q) => q.category)).toEqual(["SECURITY", "ACTION"]);
    expect(security.state.stateHash).toMatch(/^0x/);
    for (const r of provider.seen) {
      const allowed = new Set(r.questions.flatMap((q) => q.inputs));
      expect(r.state.inputs.every((i) => allowed.has(i.key))).toBe(true);
    }
  });

  it("runs agents concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    const provider: DecisionProvider = {
      id: "concurrency",
      async evaluate(req, signal) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return new ScriptedProvider({}).evaluate(req, signal);
      },
    };
    await runDecisionPipeline(deps(provider));
    expect(peak).toBe(5);
  });

  it("classifies and preserves every failure kind while the other agents succeed", async () => {
    const provider = new ScriptedProvider({
      RISK: { kind: "hang" },
      YIELD: { kind: "throw", error: new ProviderError("provider_error", "Provider returned HTTP 529") },
      SECURITY: { kind: "text", text: "I think DERISK is best." },
      MARKET: { kind: "text", text: JSON.stringify({ answers: [{ questionIndex: 4, choice: "TRANSFER_ALL", probability: 7000, factors: [], reason: "x" }] }) },
    });
    const d = await runDecisionPipeline(deps(provider, null, 100));
    const byKey = Object.fromEntries(d.agents.map((a) => [a.agentKey, a]));
    expect(byKey.RISK).toMatchObject({ status: "failed", failure: { kind: "timeout" } });
    expect(byKey.YIELD).toMatchObject({ status: "failed", failure: { kind: "provider_error" } });
    expect(byKey.SECURITY).toMatchObject({ status: "failed", failure: { kind: "invalid_json" } });
    expect(byKey.MARKET).toMatchObject({ status: "failed", failure: { kind: "schema_violation" } });
    expect(byKey.HISTORY.status).toBe("ok");
    expect(d.parallel.runs.MARKET.rawOutputHash).toMatch(/^0x/); // raw output kept for audit

    // One valid decision < quorum 4 → threshold fails → fail-safe NO_ACTION.
    expect(d.threshold.gates.quorum).toBe(false);
    expect(d.action).toMatchObject({ fork: "NO_ACTION", approvedBy: "fail-safe" });
  });

  it("records refusals and truncation", async () => {
    const d = await runDecisionPipeline(
      deps(
        new ScriptedProvider({
          RISK: { kind: "throw", error: new ProviderError("refusal", "declined") },
          YIELD: { kind: "throw", error: new ProviderError("truncated", "max tokens") },
        }),
      ),
    );
    expect(d.agents.find((a) => a.agentKey === "RISK")).toMatchObject({ failure: { kind: "refusal" } });
    expect(d.agents.find((a) => a.agentKey === "YIELD")).toMatchObject({ failure: { kind: "truncated" } });
  });

  it("never lets a model pick the final decision: disagreement falls back to NO_ACTION", async () => {
    const d = await runDecisionPipeline(
      deps(
        new ScriptedProvider({
          RISK: { kind: "answer", choice: "DERISK" },
          YIELD: { kind: "answer", choice: "DEPLOY" },
          SECURITY: { kind: "answer", choice: "DERISK" },
          MARKET: { kind: "answer", choice: "DEPLOY" },
          HISTORY: { kind: "answer", choice: "NO_ACTION" },
        }),
      ),
    );
    expect(d.threshold.passed).toBe(false);
    expect(d.action?.fork).toBe("NO_ACTION");
  });

  it("requires a guardian when ESCALATE wins", async () => {
    const all = Object.fromEntries(AGENTS.map((a) => [a.key, { kind: "answer", choice: "ESCALATE" }])) as Partial<Record<AgentKey, Script>>;
    const d = await runDecisionPipeline(deps(new ScriptedProvider(all)));
    expect(d.selectedChoice).toBe("ESCALATE");
    expect(d.action).toBeNull();
  });
});

// ─── Live mode with an in-memory execution layer (test double) ─────────────

class MemoryExecution implements ExecutionLayer {
  committed = false;
  executed: Action | null = null;
  readonly submitted: DecisionBatch[] = [];
  constructor(private readonly opts: { failSubmitFor?: number; tamperAggregation?: boolean; executeError?: string } = {}) {}
  private tx(fn: string): TxRef {
    return { chainId: 10143, hash: `0x${"ab".repeat(32)}` as Hex, blockNumber: 1n, contract: "DecisionRegistry", functionName: fn };
  }
  async commit() {
    this.committed = true;
    return { decisionId: "7", participants: AGENTS.map((a) => a.agentId), deadline: NOW + 180, txs: [this.tx("createDecision"), this.tx("openDecision")] };
  }
  async submitBatch(_id: string, agent: { agentId: number }, batch: DecisionBatch) {
    if (agent.agentId === this.opts.failSubmitFor) throw new Error("execution reverted: DeadlinePassed");
    this.submitted.push(batch);
    return this.tx("submitBatch");
  }
  private agg: Aggregation | null = null;
  setAggregation(a: Aggregation) {
    this.agg = a;
  }
  async aggregate() {
    return { tx: this.tx("aggregate"), status: "APPROVED" as Status };
  }
  async readAggregation() {
    const a = structuredClone(this.agg!);
    if (this.opts.tamperAggregation) a.support.DEPLOY += 1n;
    return { ...a, source: "engine" as const };
  }
  async execute(_id: string, action: Action) {
    if (this.opts.executeError) throw new Error(this.opts.executeError);
    this.executed = action;
    return { tx: this.tx("execute"), executedAt: NOW + 30 };
  }
}

describe("Decision pipeline — live handoff", () => {
  async function live(exec: MemoryExecution) {
    const provider = new ScriptedProvider({}, () => expect(exec.committed).toBe(true));
    // The in-memory chain mirrors the local rules; tests tamper with it explicitly.
    const d0 = await runDecisionPipeline(deps(new ScriptedProvider({})));
    exec.setAggregation({ ...d0.aggregation, decisionId: "7" });
    return runDecisionPipeline(deps(provider, exec));
  }

  it("commits before any agent runs, submits each batch, and hands the bounded action to the execution layer", async () => {
    const exec = new MemoryExecution();
    const d = await live(exec);
    expect(d.mode).toBe("live");
    expect(d.decisionId).toBe("7");
    expect(d.agentDecisions.every((a) => a.decisionId === "7")).toBe(true);
    expect(exec.submitted).toHaveLength(5);
    expect(exec.executed?.fork).toBe("DERISK");
    expect(d.execution).toMatchObject({ status: "submitted", onChainStatus: "EXECUTED", aggregationMatchesChain: true, next: { step: "resolve", availableAt: NOW + 30 + 180 } });
  });

  it("withholds execution when the chain's aggregation differs from the local rules", async () => {
    const exec = new MemoryExecution({ tamperAggregation: true });
    const d = await live(exec);
    expect(exec.executed).toBeNull();
    expect(d.execution).toMatchObject({ aggregationMatchesChain: false, next: { step: "investigate" } });
  });

  it("does not aggregate early when a submission failed, and reports it", async () => {
    const exec = new MemoryExecution({ failSubmitFor: 2 });
    const d = await live(exec);
    expect(d.execution).toMatchObject({ onChainStatus: "OPEN", next: { step: "aggregate", availableAt: NOW + 181 } });
    if (d.execution.status === "submitted") expect(d.execution.submissionErrors).toEqual([{ agentId: 2, message: "execution reverted: DeadlinePassed" }]);
    expect(d.aggregation.submissions).toBe(4); // failed submission is not counted
  });

  it("reports an execution failure as the next step instead of hiding it", async () => {
    const exec = new MemoryExecution({ executeError: "PYTH_API_KEY is not configured; signed price updates are unavailable" });
    const d = await live(exec);
    expect(d.execution).toMatchObject({ onChainStatus: "APPROVED", next: { step: "execute", reason: expect.stringContaining("PYTH_API_KEY") } });
  });
});
