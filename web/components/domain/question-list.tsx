import { AGENTS } from "@/lib/jev/agents";
import type { QuestionSet } from "@/lib/jev/questions";

/** Jev questions rendered verbatim, with who answers them and how they are scored. */
export function QuestionList({ set }: { set: QuestionSet }) {
  return (
    <ol className="border border-rule bg-surface">
      {set.questions.map((q) => {
        const answeredBy = AGENTS.filter((a) => set.assignment[a.key].includes(q.id));
        const totalWeight = q.rubric.reduce((t, f) => t + f.weight, 0);
        return (
          <li key={q.id} className="grid gap-4 border-b border-rule px-4 py-4 last:border-b-0 md:grid-cols-[72px_1fr_280px]">
            <div className="flex items-baseline gap-2 md:flex-col md:gap-1">
              <span className="font-mono text-[12px] text-ink-3">Q{q.id}</span>
              <span className="text-[11px] font-medium tracking-[0.06em] text-ink-2">{q.key}</span>
            </div>
            <div>
              <p className="text-[14px] leading-[22px]">{q.text}</p>
              <p className="mt-2 text-[12px] text-ink-2">
                Answered by {answeredBy.length === AGENTS.length ? "all five agents" : answeredBy.map((a) => a.name).join(", ")}
              </p>
            </div>
            <details className="text-[12px] text-ink-2">
              <summary className="cursor-pointer select-none text-ink">Rubric · {q.rubric.length} factors</summary>
              <ul className="mt-2 space-y-1.5">
                {q.rubric.map((f) => (
                  <li key={f.factor} className="grid grid-cols-[1fr_auto] gap-2">
                    <span>
                      <span className="font-mono text-ink">{f.factor}</span> — {f.description}
                    </span>
                    <span className="font-mono tabular text-ink-3">
                      {f.weight}/{totalWeight}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
