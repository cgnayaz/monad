import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WagmiProvider } from "wagmi";
import { ProviderError } from "@/lib/ai/provider";
import { wagmiConfig } from "@/lib/chain/wagmi";
import { settle } from "@/lib/decmarkt/settlement";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { toWireJson, type Wire } from "@/lib/engine/wire";
import { AGENTS } from "@/lib/jev/agents";
import { buildState } from "@/lib/jev/state";
import { correctFork } from "@/lib/jev/verify";
import type { FinalDecision } from "@/lib/model/final-decision";
import { toProbability } from "@/lib/model/primitives";
import { FORKS } from "@/lib/types/protocol";
import { fromRound } from "@/lib/view/decision-view";
import { ScriptedProvider } from "@/test/fixtures/scripted-provider";
import { ActionStep, AggregationStep, BatchStep, ForksStep, MonadStep, ParallelStep, PrimitivesStep, SettlementStep, VerifyStep } from "./step-content";

const NOW = 1_790_000_000;

function withProviders(node: ReactNode) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </WagmiProvider>
  );
}

async function simulationRound() {
  const d = await runDecisionPipeline({
    collectState: async () =>
      buildState(
        { vault: null, asset: "MON", referenceFeed: "ETH/USD", horizonSec: 60, bandBps: 10 },
        [
          { key: "market.ref.price", value: 0.0347, unit: "USD", source: "pyth-hermes", observedAt: NOW, status: "ok" },
          { key: "network.block_number", value: "100", source: "monad-rpc", observedAt: NOW, status: "ok" },
        ],
        NOW,
      ),
    provider: new ScriptedProvider({
      YIELD: { kind: "answer", choice: "NO_ACTION", probability: 5800 },
      HISTORY: { kind: "throw", error: new ProviderError("timeout", "No response within 60000 ms") },
    }),
    agents: AGENTS,
    params: { submissionWindow: 90, horizon: 60, bandBps: 10, thresholdBps: 6000, minActionScore: 5500, quorum: 4, allowedForks: [...FORKS], lockPerAgent: 50_000_000_000_000_000n },
    reputation: { source: "none-recorded", records: {} },
    execution: null,
    simulationReason: "Simulation mode: no transactions are sent",
    now: () => NOW,
  });
  return JSON.parse(toWireJson(d)) as Wire<FinalDecision>;
}

describe("Demo steps render real pipeline output", () => {
  it("shows parallel lanes, primitives, question-level batch and the fork space", async () => {
    const d = await simulationRound();
    const v = fromRound({ state: d.state, questions: d.questions, runs: {}, running: {}, submissions: {}, decision: d });

    const lanes = renderToStaticMarkup(<ParallelStep v={v} startedAt={null} />);
    expect(lanes).toContain("Timeout");
    expect(lanes.match(/decided/g)).toHaveLength(4);

    const prims = renderToStaticMarkup(<PrimitivesStep v={v} />);
    expect(prims).toContain("DERISK");
    expect(prims).toContain("counted as missed");

    const batch = renderToStaticMarkup(<BatchStep v={v} decision={d} />);
    expect(batch).toContain("final decision → aggregation");
    expect(batch).toContain("no answer"); // the failed agent's assigned cells

    const forks = renderToStaticMarkup(<ForksStep v={v} allowed={[...FORKS]} />);
    for (const f of FORKS) expect(forks).toContain(f);
    expect(forks).toContain("ACTION_A");
  });

  it("shows aggregation, the action, the absence of transactions, verify and notional settlement in simulation", async () => {
    const d = await simulationRound();
    const v = fromRound({ state: d.state, questions: d.questions, runs: {}, running: {}, submissions: {}, decision: d });

    const agg = renderToStaticMarkup(<AggregationStep v={v} />);
    expect(agg).toContain("Aggregate score");
    expect(agg).toContain("DERISK");

    const action = renderToStaticMarkup(<ActionStep v={v} mode="simulation" sim={{ fork: "DERISK", start: { price: "3471000", expo: -8, publishTime: NOW } }} />);
    expect(action).toContain("no transaction");

    const monad = renderToStaticMarkup(withProviders(<MonadStep mode="simulation" txs={[]} awaiting={false} onExecute={() => {}} />));
    expect(monad).toContain("No transactions");

    const observed = correctFork(3_471_000n, 3_452_000n, 10);
    const verify = renderToStaticMarkup(
      <VerifyStep
        mode="simulation"
        r={{ expected: "DERISK", observed, success: observed === "DERISK", startPrice: "0.03471", endPrice: "0.03452", startTime: NOW, endTime: NOW + 60, moveBps: "-54", bandBps: 10, source: "pyth-offchain" }}
      />,
    );
    expect(verify).toContain("success");
    expect(verify).toContain("not verified on-chain in simulation");

    const sim = settle(
      "0",
      d.agents.map((a) => ({ agentId: a.agentId, bond: 50_000_000_000_000_000n, submission: a.status === "ok" ? { choice: a.final.choice, probability: toProbability(a.final.probability) } : null })),
      observed,
      { slashBps: 3000, missPenaltyBps: 1000, roundReward: 20_000_000_000_000_000n },
    );
    const settlement = renderToStaticMarkup(<SettlementStep mode="simulation" v={v} sim={sim} />);
    expect(settlement).toContain("MISSED");
    expect(settlement).toContain("CORRECT");
    expect(settlement).toContain("notional bonds");
  });
});
