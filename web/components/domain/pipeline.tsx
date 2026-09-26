/**
 * The DecMarkt pipeline as a typeset sequence (ARCHITECTURE.md §2). Each stage names
 * the layer and the component responsible for it.
 */

type Layer = "Jev" | "DecMarkt" | "Monad";

export const PIPELINE: { stage: string; layer: Layer; where: string; detail: string }[] = [
  { stage: "Real state", layer: "Jev", where: "collectors", detail: "Pyth MON/USD, Monad RPC, vault and registry views." },
  { stage: "Jev state", layer: "Jev", where: "lib/jev/state", detail: "Canonical JSON (RFC 8785), versioned, every input sourced; keccak256 → stateHash." },
  { stage: "Jev questions", layer: "Jev", where: "lib/jev/questions", detail: "Six explicit questions with rubrics; keccak256 → questionsHash." },
  { stage: "Commit", layer: "Monad", where: "DecisionRegistry", detail: "stateHash and questionsHash written on-chain before any agent runs." },
  { stage: "Parallel decisions", layer: "Jev", where: "lib/jev/parallel", detail: "Five isolated agent runs over the same state and questions." },
  { stage: "Choice · Score · Probability", layer: "Jev", where: "lib/jev/primitives", detail: "Validated output; score computed from rubric ratings, never by the model." },
  { stage: "Batch", layer: "Jev", where: "lib/jev/batch", detail: "All of an agent's answers form one batch; every (agent, question) answer keeps its own record." },
  { stage: "Bonded submission", layer: "DecMarkt", where: "DecisionRegistry.submitBatch", detail: "Each agent's operator key submits its batch against its locked bond; invalid choices, scores and probabilities revert." },
  { stage: "Decision engine", layer: "DecMarkt", where: "DecisionEngine.aggregate", detail: "Integer aggregation: probability × track record per fork." },
  { stage: "Threshold", layer: "DecMarkt", where: "DecisionEngine", detail: "Quorum, winning share and minimum score gates; failure → NO_ACTION." },
  { stage: "Bounded action", layer: "Monad", where: "ExecutionVault.execute", detail: "Only the approved fork runs. No external calls, no AI calldata." },
  { stage: "Real outcome", layer: "Monad", where: "Pyth", detail: "Signed MON/USD price at execution and after the horizon." },
  { stage: "Verify", layer: "Monad", where: "OutcomeRegistry.resolve", detail: "Publish-time window enforced; correct fork derived from the move." },
  { stage: "Reward / penalty", layer: "DecMarkt", where: "OutcomeRegistry", detail: "Deterministic settlement of every bond. Agents have no input." },
];

const layerStyle: Record<Layer, string> = {
  Jev: "text-ink",
  DecMarkt: "text-accent",
  Monad: "text-ink-2",
};

export function Pipeline({ compact = false }: { compact?: boolean }) {
  return (
    <ol className="border border-rule bg-surface">
      {PIPELINE.map((p, i) => (
        <li
          key={p.stage}
          className={`grid grid-cols-[40px_1fr] gap-x-4 border-b border-rule px-4 last:border-b-0 ${compact ? "py-2" : "py-3"} md:grid-cols-[40px_220px_96px_1fr]`}
        >
          <span className="font-mono text-[12px] text-ink-3 tabular">{String(i + 1).padStart(2, "0")}</span>
          <span className="font-medium">{p.stage}</span>
          <span className={`col-start-2 text-[11px] font-medium uppercase tracking-[0.06em] md:col-start-auto ${layerStyle[p.layer]}`}>
            {p.layer}
          </span>
          {!compact && (
            <span className="col-start-2 text-ink-2 md:col-start-auto">
              {p.detail} <span className="font-mono text-[11.5px] text-ink-3">{p.where}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
