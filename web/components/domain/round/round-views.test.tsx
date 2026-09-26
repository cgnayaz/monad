import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/ai/provider";
import { AGENTS } from "@/lib/jev/agents";
import { buildState } from "@/lib/jev/state";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { toWireJson } from "@/lib/engine/wire";
import { FORKS } from "@/lib/types/protocol";
import { ScriptedProvider } from "@/test/fixtures/scripted-provider";
import { AgentResults, DecisionSummary, type WDecision, type WRun } from "./round-views";

const NOW = 1_790_000_000;

describe("Round result views", () => {
  it("render a pipeline result and identify each failed agent", async () => {
    const d = await runDecisionPipeline({
      collectState: async () =>
        buildState(
          { vault: null, asset: "MON", referenceFeed: "MON/USD", horizonSec: 180, bandBps: 10 },
          [{ key: "market.mon_usd.price", value: 0.04, source: "pyth-hermes", observedAt: NOW, status: "ok" }],
          NOW,
        ),
      provider: new ScriptedProvider({
        RISK: { kind: "throw", error: new ProviderError("timeout", "No response within 60000 ms") },
        MARKET: { kind: "text", text: "not json" },
      }),
      agents: AGENTS,
      params: { submissionWindow: 180, horizon: 180, bandBps: 10, thresholdBps: 6000, minActionScore: 5500, quorum: 3, allowedForks: [...FORKS], lockPerAgent: 1n },
      reputation: { source: "none-recorded", records: {} },
      execution: null,
      previewReason: "contracts not deployed",
      now: () => NOW,
    });
    // Exactly what the browser receives over the wire.
    const wire = JSON.parse(toWireJson(d)) as WDecision;
    const runs = Object.fromEntries(Object.values(wire.parallel.runs).map((r) => [r.agentKey, r])) as Record<string, WRun>;

    const agents = renderToStaticMarkup(<AgentResults runs={runs} running={false} />);
    expect(agents).toContain("Timeout");
    expect(agents).toContain("Invalid JSON");
    expect(agents).toContain("settled as MISSED");
    expect(agents.match(/>ok</g)).toHaveLength(3);

    const summary = renderToStaticMarkup(<DecisionSummary d={wire} />);
    expect(summary).toContain("DERISK");
    expect(summary).toContain("Not submitted — contracts not deployed");
    expect(summary).toContain("preview");
  });
});
