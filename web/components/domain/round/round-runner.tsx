"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/layout";
import { EmptyState, StatusMark } from "@/components/ui/status";
import type { Wire } from "@/lib/engine/wire";
import { PIPELINE_STAGES, type PipelineEvent, type PipelineStage } from "@/lib/model/final-decision";
import { AgentResults, DecisionSummary, StageList, type StageState, type WDecision, type WRun } from "./round-views";

type WEvent = Wire<PipelineEvent>;

const initialStages = () =>
  Object.fromEntries(PIPELINE_STAGES.map((s) => [s, { status: "pending" }])) as Record<PipelineStage, StageState>;

/**
 * Runs one decision round via POST /api/decisions and renders its NDJSON event stream as
 * it arrives. The browser sends nothing but the request itself.
 */
export function RoundRunner({ mode, modeDetail, aside }: { mode: "live" | "preview" | "unavailable"; modeDetail: string; aside?: ReactNode }) {
  const [stages, setStages] = useState(initialStages);
  const [runs, setRuns] = useState<Record<string, WRun | undefined>>({});
  const [decision, setDecision] = useState<WDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  const handle = useCallback((e: WEvent) => {
    switch (e.type) {
      case "stage":
        setStages((s) => ({ ...s, [e.stage]: { status: e.status, detail: e.detail, txs: e.txs } }));
        break;
      case "agent":
        setRuns((r) => ({ ...r, [e.run.agentKey]: e.run }));
        break;
      case "result":
        setDecision(e.decision);
        break;
      case "error":
        setError(e.message);
        break;
    }
  }, []);

  const start = useCallback(async () => {
    setStages(initialStages());
    setRuns({});
    setDecision(null);
    setError(null);
    setRunning(true);
    setStarted(true);
    try {
      const res = await fetch("/api/decisions", { method: "POST" });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const retry = res.headers.get("Retry-After");
        setError(`${body?.error ?? `Request failed (${res.status})`}${retry ? ` — retry in ${retry} s` : ""}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as WEvent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection lost");
    } finally {
      setRunning(false);
    }
  }, [handle]);

  const download = useMemo(() => {
    if (!decision) return null;
    return URL.createObjectURL(new Blob([JSON.stringify(decision, null, 2)], { type: "application/json" }));
  }, [decision]);

  const failed = Object.values(runs).filter((r) => r?.status === "failed").length;

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border border-rule bg-surface">
          <div className="flex flex-wrap items-center gap-4 border-b border-rule px-4 py-3">
            <Button onClick={start} disabled={mode === "unavailable" || running}>
              {running ? "Running…" : mode === "live" ? "Start live round" : mode === "preview" ? "Run preview round" : "Run round"}
            </Button>
            <StatusMark tone={mode === "live" ? "accent" : mode === "preview" ? "wait" : "neutral"}>{mode}</StatusMark>
            <p className="text-[13px] text-ink-2">{modeDetail}</p>
          </div>
          <StageList stages={stages} />
        </div>
        <div className="space-y-3 text-[13px] text-ink-2">
          {aside}
          <p>
            Agents run concurrently. Each returns a choice from the four bounded forks, rubric ratings (the score is computed from them), a probability
            and a short reason. Aggregation, threshold and action are fixed rules; no model is asked for the final decision.
          </p>
          <p>The reason is informational only. Execution depends solely on the choice, score and probability through the rules above.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="border border-fail px-4 py-3 text-[13px] text-fail">
          {error}
        </div>
      )}

      {started && (
        <Section
          index="A"
          title="Agent decisions"
          description="Every individual output is preserved, including failures."
          aside={failed > 0 ? <StatusMark tone="fail">{failed} agent(s) failed</StatusMark> : undefined}
        >
          <AgentResults runs={runs} running={running} />
        </Section>
      )}

      {decision ? (
        <Section
          index="B"
          title="Final decision"
          aside={
            download && (
              <a href={download} download={`decmarkt-${decision.mode}-${decision.state.stateId}.json`} className="text-[13px] text-ink-2 underline decoration-rule underline-offset-2 hover:text-ink">
                Download decision object
              </a>
            )
          }
        >
          <DecisionSummary d={decision} />
        </Section>
      ) : (
        !started && (
          <EmptyState title="No round run in this session">
            {mode === "unavailable"
              ? "Configure an AI provider to run a round. Until then no decision can be produced."
              : "Start a round to snapshot the current state, run the five analysts and evaluate the result with the deterministic rules."}
          </EmptyState>
        )
      )}
    </div>
  );
}
