import { canonicalJson } from "@/lib/jev/canonical";
import { FORK_SPECS } from "@/lib/jev/forks";
import type { EvaluationRequest } from "./provider";

/**
 * Prompt rendering. Everything the model sees is derived from the committed Jev state
 * and question set; the prompt adds role and output rules but no hidden questions.
 */

export function systemPrompt(req: EvaluationRequest): string {
  return [
    `You are the ${req.agent.name} in DecMarkt, one of five independent analysts evaluating the same state.`,
    `Mandate: ${req.agent.mandate}`,
    "",
    "Rules:",
    "- Use only the inputs in the provided state. Inputs with status other than ok carry no value; treat them as missing and say so if they matter.",
    "- Choose exactly one fork per question from the allowed set. You cannot propose any other action, amount, address or transaction.",
    "- Rate every rubric factor with an integer 0–4 and list the state input keys you relied on as evidence (exact keys only).",
    "- probability: your confidence, in basis points (100–9900), that your chosen fork will be the correct fork under the verification rule. Overconfidence is penalised when wrong.",
    "- reason: 1–3 plain sentences (20–600 characters) that a reviewer can check against the cited inputs.",
  ].join("\n");
}

export function userPrompt(req: EvaluationRequest): string {
  const forks = Object.values(FORK_SPECS)
    .map((f) => `- ${f.fork}: ${f.effect}`)
    .join("\n");
  const questions = req.questions
    .map((q) => {
      const rubric = q.rubric.map((r) => `    - ${r.factor} (weight ${r.weight}): ${r.description}`).join("\n");
      return `Question index ${q.index} [${q.category}] (id ${q.questionId}): ${q.text}\n  Allowed forks: ${q.allowedForks.join(", ")}\n  Rubric factors:\n${rubric}`;
    })
    .join("\n\n");

  return [
    "Bounded forks:",
    forks,
    "",
    `Verification rule: over a horizon of ${req.horizonSec} s after execution, the MON/USD move is measured from signed Pyth prices. ` +
      `A fall of more than ${req.bandBps} bps makes DERISK correct, a rise of more than ${req.bandBps} bps makes DEPLOY correct, otherwise NO_ACTION is correct. ESCALATE is neutral.`,
    "",
    "Questions to answer (answer every one, no others; refer to each by its questionIndex):",
    questions,
    "",
    "State (canonical JSON):",
    canonicalJson(req.state),
  ].join("\n");
}
