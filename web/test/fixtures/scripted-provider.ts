import type { DecisionProvider, EvaluationRequest } from "@/lib/ai/provider";
import type { AgentKey, Fork } from "@/lib/types/protocol";

/**
 * TEST ONLY. A provider that answers every assigned question according to a per-agent
 * script, so pipeline behaviour can be tested without a model. Never used by the app.
 */
export type Script =
  | { kind: "answer"; choice: Fork; probability?: number; rating?: number }
  | { kind: "text"; text: string }
  | { kind: "throw"; error: Error }
  | { kind: "hang" };

/** Test-only provider: answers every assigned question according to a per-agent script. */
export class ScriptedProvider implements DecisionProvider {
  readonly id = "scripted";
  readonly seen: EvaluationRequest[] = [];
  constructor(
    private readonly scripts: Partial<Record<AgentKey, Script>>,
    private readonly onCall?: () => void,
  ) {}
  async evaluate(req: EvaluationRequest, signal: AbortSignal) {
    this.onCall?.();
    this.seen.push(req);
    const s = this.scripts[req.agent.key] ?? { kind: "answer", choice: "DERISK" };
    if (s.kind === "throw") throw s.error;
    if (s.kind === "hang") {
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    const text =
      s.kind === "text"
        ? s.text
        : JSON.stringify({
            answers: req.questions.map((q) => ({
              questionIndex: q.index,
              choice: s.kind === "answer" ? s.choice : "NO_ACTION",
              probability: s.kind === "answer" ? (s.probability ?? 7000) : 5000,
              factors: q.rubric.map((f) => ({ factor: f.factor, rating: s.kind === "answer" ? (s.rating ?? 3) : 2, evidence: q.inputs.slice(0, 1) })),
              reason: "Short-term change is negative and exceeds the band; downside risk dominates.",
            })),
          });
    return { provider: this.id, model: "scripted-model", rawText: text, latencyMs: 1 };
  }
}

