import type { Metadata } from "next";
import Link from "next/link";
import { ForkTable } from "@/components/domain/fork-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { Pipeline } from "@/components/domain/pipeline";
import { PageHeader, Section } from "@/components/ui/layout";
import { Table, Td, Th } from "@/components/ui/table";

export const metadata: Metadata = { title: "How it works" };

const JEV_MAP: [string, string, string][] = [
  ["State", "Canonical JSON of sourced inputs, hashed and committed before agents run", "Decision.stateHash"],
  ["Questions", "Six explicit questions with weighted rubrics, rendered verbatim", "Decision.questionsHash"],
  ["Choice", "One of four bounded forks, mapped through a closed table", "Submission.choice"],
  ["Score", "Computed from 0–4 factor ratings by a fixed formula; never output by the model", "Submission.score"],
  ["Probability", "Confidence in basis points (1–99 %); weights the vote and the settlement", "Submission.probability"],
  ["Parallel decisions", "Five isolated runs, each submitted from its own operator address", "5 × submit"],
  ["Batch decisions", "Every (agent, question) answer is a Merkle leaf", "Submission.answersRoot"],
  ["Bounded forks", "Fixed enum plus per-decision mask; one code path per fork in the vault", "Decision.allowedForks"],
  ["Action", "Only the fork approved by the engine executes", "ExecutionVault.execute"],
  ["Verify", "Signed oracle price inside a strict window; hashes recomputed in the browser", "OutcomeRegistry.resolve"],
];

const GUARANTEES = [
  ["The AI cannot choose an arbitrary action.", "Choices are validated against a closed enum and the per-decision fork mask."],
  ["The AI cannot produce calldata or sign.", "Keys stay on the server; every transaction's target and ABI are fixed in code."],
  ["The AI does not decide the outcome.", "Aggregation and threshold are integer math in DecisionEngine."],
  ["The AI does not settle itself.", "Rewards and penalties follow from the oracle outcome by fixed rules."],
  ["Disagreement never moves funds.", "Any failed gate approves NO_ACTION."],
  ["Nothing shown is simulated.", "Chain values come from the chain; missing data is marked unavailable."],
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Protocol"
        title="How DecMarkt works"
        lead="Jev structures decisions. DecMarkt makes them accountable. Monad makes the result enforceable and auditable."
      />

      <Section index="01" title="The pipeline" description="From real-world state to settled bonds. Each stage names the layer and component responsible for it.">
        <Pipeline />
      </Section>

      <Section
        index="02"
        title="What is being decided"
        description="An on-chain vault holds test MON in two buckets, ACTIVE and RESERVE. For each round, agents decide whether to move part of it between the buckets over the next horizon. The correct answer is defined by the MON/USD price move measured from signed Pyth prices, so it is never a matter of opinion."
      >
        <ForkTable />
      </Section>

      <Section index="03" title="Lifecycle" description="Enforced in DecisionRegistry. Invalid transitions revert; each reached state records its block.">
        <LifecycleRail />
      </Section>

      <Section index="04" title="Jev concepts in the implementation">
        <Table caption="Jev mapping">
          <thead>
            <tr>
              <Th>Jev concept</Th>
              <Th>Implementation</Th>
              <Th>On-chain anchor</Th>
            </tr>
          </thead>
          <tbody>
            {JEV_MAP.map(([c, impl, anchor]) => (
              <tr key={c}>
                <Td className="whitespace-nowrap font-medium">{c}</Td>
                <Td className="min-w-[320px] text-ink-2">{impl}</Td>
                <Td mono className="whitespace-nowrap">{anchor}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-[13px] text-ink-2">
          Full mapping in{" "}
          <Link href="/docs/jev-integration" className="text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
            Jev integration
          </Link>
          .
        </p>
      </Section>

      <Section index="05" title="Guarantees">
        <dl className="grid border border-rule bg-surface md:grid-cols-2">
          {GUARANTEES.map(([g, why], i) => (
            <div key={g} className={`border-rule px-5 py-4 ${i % 2 === 0 ? "md:border-r" : ""} ${i >= 2 ? "border-t" : i === 1 ? "border-t md:border-t-0" : ""}`}>
              <dt className="font-medium">{g}</dt>
              <dd className="mt-1 text-ink-2">{why}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
