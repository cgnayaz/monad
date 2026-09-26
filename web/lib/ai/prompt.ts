import { canonicalJson } from "@/lib/jev/canonical";
import { ACTION_SPACE } from "@/lib/model/action";
import { FORKS } from "@/lib/types/protocol";
import type { EvaluationRequest } from "./provider";

/**
 * Prompt rendering. Everything the model sees is derived from the committed Jev state and
 * the explicit question set; the prompt adds the agent's role and output rules but no
 * hidden questions. The model's output is a recommendation only: it cannot sign, execute,
 * change thresholds or contract rules, or produce calldata.
 */

export function systemPrompt(req: EvaluationRequest): string {
  return [
    `You are the ${req.agent.name} in DecMarkt, one of five independent analysts evaluating the same committed state.`,
    `Your analytical responsibility: ${req.agent.mandate}`,
    "",
    "Rules:",
    "- Use only the inputs in the provided state. Inputs whose status is not ok carry no value; treat them as missing and say so when they matter.",
    "- For every question, choose exactly one fork from its allowed set. You cannot propose any other action, amount, address or transaction.",
    "- Rate every rubric factor with an integer 0–4 and list the exact state input keys you relied on as evidence. Your score is computed from these ratings.",
    "- probability: your confidence, in basis points (100–9900), that your chosen fork will be the correct fork under the verification rule. Overconfidence is penalised when wrong.",
    "- reason: 1–3 plain sentences (20–600 characters) that a reviewer can check against the cited inputs. It is informational and never used to execute anything.",
    "- Answer each question on its own merits; the questions form one batch but each answer is recorded separately.",
  ].join("\n");
}

export function userPrompt(req: EvaluationRequest): string {
  const forks = FORKS.map((f) => `- ${f} (${ACTION_SPACE[f].alias}): ${ACTION_SPACE[f].effect}`).join("\n");
  const questions = req.questions
    .map((q) => {
      const rubric = q.rubric.map((r) => `    - ${r.factor} (weight ${r.weight}): ${r.description}`).join("\n");
      return [
        `questionIndex ${q.index} [${q.category}] (id ${q.questionId}): ${q.text}`,
        `  Allowed forks: ${q.allowedForks.join(", ")}`,
        `  Relevant inputs (${q.availableInputs}/${q.inputs.length} available): ${q.inputs.join(", ") || "none"}`,
        `  Rubric factors:\n${rubric}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Bounded forks:",
    forks,
    "",
    `Verification rule: over a horizon of ${req.horizonSec} s after execution, the ${req.state.subject.referenceFeed} move is measured from signed Pyth prices. ` +
      `A fall of more than ${req.bandBps} bps makes DERISK correct, a rise of more than ${req.bandBps} bps makes DEPLOY correct, otherwise NO_ACTION is correct. ESCALATE is neutral.`,
    "",
    "Questions to answer (answer every one and no others; refer to each by its questionIndex):",
    questions,
    "",
    "State relevant to your questions (canonical JSON):",
    canonicalJson(req.state),
  ].join("\n");
}
