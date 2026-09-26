import "server-only";
import { checkQuestionSet, checkReasonHash, checkState, type IntegrityCheck } from "@/lib/jev/verify";
import type { AgentRun, ParallelDecisions } from "@/lib/model/decision";
import type { DecisionProvenance } from "@/lib/model/provenance";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import { payloadStore } from "@/lib/store/payload-store";
import { StateRecordSchema } from "@/lib/validation/state";
import { AGENT_KEYS, type AgentKey } from "@/lib/types/protocol";

/**
 * Load the off-chain payloads of a decision and attach only what verifies against the
 * chain: the state and question set must hash to the committed values, every answer's
 * reason must hash to its on-chain reasonHash, and every answer must equal its on-chain
 * submission. Each check is returned so the UI can show it.
 */
export interface VerifiedPayloads {
  provenance: DecisionProvenance;
  checks: IntegrityCheck[];
  store: { available: true; kind: string } | { available: false; reason: string };
}

export async function attachVerifiedPayloads(p: DecisionProvenance): Promise<VerifiedPayloads> {
  const s = payloadStore();
  if (!s.store) {
    return {
      provenance: p,
      checks: [checkState(p.decision.stateHash, null), checkQuestionSet(p.decision.questionsHash, null)],
      store: { available: false, reason: s.reason },
    };
  }
  const store = s.store;
  const checks: IntegrityCheck[] = [];
  const out: DecisionProvenance = { ...p };

  const rawState = await store.getState(p.decision.stateHash).catch(() => null);
  const parsedState = rawState ? StateRecordSchema.safeParse(rawState) : null;
  const state = parsedState?.success ? (parsedState.data as StateRecord) : null;
  const stateCheck = checkState(p.decision.stateHash, state);
  checks.push(stateCheck);
  if (state && stateCheck.status === "VERIFIED") out.state = state;

  const rawQuestions = (await store.getQuestions(p.decision.questionsHash).catch(() => null)) as QuestionSet | null;
  const qCheck = checkQuestionSet(p.decision.questionsHash, rawQuestions && typeof rawQuestions === "object" ? rawQuestions : null);
  checks.push(qCheck);
  if (rawQuestions && qCheck.status === "VERIFIED") out.questions = rawQuestions;

  const runs: Partial<Record<AgentKey, AgentRun>> = {};
  for (const agentId of p.decision.participants) {
    const raw = (await store.getRun(p.decision.decisionId, agentId).catch(() => null)) as AgentRun | null;
    if (!raw || typeof raw !== "object" || !AGENT_KEYS.includes(raw.agentKey)) {
      checks.push({ label: `agent ${agentId} run`, onChain: null, recomputed: null, status: "UNAVAILABLE" });
      continue;
    }
    // bigint fields travel as strings
    const run: AgentRun = {
      ...raw,
      batch: raw.batch ? { ...raw.batch, decisions: raw.batch.decisions.map((d) => ({ ...d, bond: BigInt(d.bond as unknown as string) })) } : null,
      final: raw.final ? { ...raw.final, bond: BigInt(raw.final.bond as unknown as string) } : null,
    };
    let ok = run.agentId === agentId && run.decisionId === p.decision.decisionId;
    for (const d of run.batch?.decisions ?? []) {
      const onChain = p.submissions.find((x) => x.agentId === agentId && x.questionIndex === d.questionIndex);
      const c = checkReasonHash(`agent ${agentId} · Q${d.questionIndex} reason`, onChain?.reasonHash ?? null, d.reason);
      checks.push(c);
      const same = onChain && onChain.choice === d.choice && onChain.score === d.score && onChain.probability === d.probability;
      if (c.status !== "VERIFIED" || !same) ok = false;
    }
    if (ok) runs[run.agentKey] = run;
  }
  if (Object.keys(runs).length > 0 && out.state !== p.state) {
    out.parallel = {
      decisionId: p.decision.decisionId,
      stateId: (out.state as StateRecord).stateId,
      questionSetHash: p.decision.questionsHash,
      runs: runs as ParallelDecisions["runs"],
    };
  }
  return { provenance: out, checks, store: { available: true, kind: store.kind } };
}
