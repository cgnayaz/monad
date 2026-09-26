import { z } from "zod";
import { FORKS, PROBABILITY_MAX, PROBABILITY_MIN } from "@/lib/types/protocol";
import type { Question } from "@/lib/model/question";
import type { StateSlice } from "@/lib/model/state";

/**
 * The only shape accepted from an AI model (DATA_MODEL.md §3).
 *
 * `WireOutput` is sent to the provider as the structured-output schema. It carries no
 * numeric bounds because providers may not enforce them; `validateModelOutput` is the
 * authoritative check and runs on every response. The model refers to questions by
 * their on-chain index; ids are attached afterwards by the Jev layer.
 */

export const WireAnswer = z.object({
  questionIndex: z.number().int(),
  choice: z.enum(FORKS),
  probability: z.number().int(),
  factors: z.array(
    z.object({
      factor: z.string(),
      rating: z.number().int(),
      evidence: z.array(z.string()),
    }),
  ),
  reason: z.string(),
});

export const WireOutput = z.object({ answers: z.array(WireAnswer) });

const StrictAnswer = z
  .object({
    questionIndex: z.number().int().min(0).max(5),
    choice: z.enum(FORKS),
    probability: z.number().int().min(PROBABILITY_MIN).max(PROBABILITY_MAX),
    factors: z
      .array(
        z
          .object({
            factor: z.string(),
            rating: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
            evidence: z.array(z.string()).max(8),
          })
          .strict(),
      )
      .min(1),
    reason: z.string().trim().min(20).max(600),
  })
  .strict();

const StrictOutput = z.object({ answers: z.array(StrictAnswer).min(1).max(6) }).strict();

export type ModelAnswer = z.infer<typeof StrictAnswer>;

export type Validation =
  | { ok: true; answers: ModelAnswer[] }
  | { ok: false; errors: string[] };

/**
 * Schema validation plus semantic checks against the committed state and the agent's
 * assigned questions: exact question coverage, exact rubric factors, evidence keys that
 * the agent was actually given, and choices inside each question's allowed forks.
 */
export function validateModelOutput(raw: unknown, ctx: { state: StateSlice; assigned: Question[] }): Validation {
  const parsed = StrictOutput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const errors: string[] = [];
  const answers = parsed.data.answers;
  const stateKeys = new Set(ctx.state.inputs.map((i) => i.key)); // only what this agent was shown

  const got = answers.map((a) => a.questionIndex).sort();
  const want = ctx.assigned.map((q) => q.index).sort();
  if (got.length !== want.length || got.some((q, i) => q !== want[i])) {
    errors.push(`answers must cover exactly questions [${want.join(", ")}], got [${got.join(", ")}]`);
  }

  for (const a of answers) {
    const q = ctx.assigned.find((x) => x.index === a.questionIndex);
    if (!q) continue; // already reported above
    if (!q.allowedForks.includes(a.choice)) errors.push(`q${a.questionIndex}: choice ${a.choice} not allowed`);
    const rubric = q.rubric.map((f) => f.factor).sort();
    const rated = a.factors.map((f) => f.factor).sort();
    if (rubric.length !== rated.length || rubric.some((f, i) => f !== rated[i])) {
      errors.push(`q${a.questionIndex}: factors must be exactly [${rubric.join(", ")}]`);
    }
    for (const f of a.factors) {
      for (const k of f.evidence) {
        if (!stateKeys.has(k)) errors.push(`q${a.questionIndex}.${f.factor}: evidence key ${k} not in state`);
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, answers };
}
