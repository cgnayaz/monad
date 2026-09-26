import type { Metadata } from "next";
import Link from "next/link";
import { ForkTable } from "@/components/domain/fork-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { Pipeline } from "@/components/domain/pipeline";
import { PageHeader, Section } from "@/components/ui/layout";
import { Table, Td, Th } from "@/components/ui/table";

export const metadata: Metadata = { title: "How it works" };

const LAYERS = [
  {
    n: "1",
    name: "Jev",
    role: "structures the decision",
    does: "Turns the world into a hashed state, asks explicit questions about it, and has five independent analysts answer each question with a choice from a closed set, rubric ratings that produce a score, a probability and a reason.",
    produces: "State · Questions · Choice · Score · Probability",
    code: "web/lib/jev",
  },
  {
    n: "2",
    name: "DecMarkt",
    role: "adds accountability",
    does: "Gives every analyst an on-chain identity and a bond, aggregates their decisions with fixed integer rules, applies the threshold, selects one bounded action, and settles every bond against the verified outcome.",
    produces: "Aggregate · Threshold · Action · Reward / penalty",
    code: "web/lib/decmarkt, DecisionEngine, OutcomeRegistry",
  },
  {
    n: "3",
    name: "Monad",
    role: "enforces and records the result",
    does: "Holds the lifecycle, the submissions, the bonds and the treasury in contracts. Only the approved action can execute; the outcome is taken from a signed Pyth price inside a strict window; every step is a public transaction.",
    produces: "Transactions · Execution · Verified outcome · Settlement",
    code: "contracts/src",
  },
];

const JEV_MAP: [string, string, string][] = [
  ["State", "Canonical JSON of sourced inputs, hashed and committed before agents run", "Decision.stateHash"],
  ["Questions", "Six explicit questions, each with its own id and the inputs it evaluates", "Decision.questionSetHash"],
  ["Choice", "One of four bounded forks, validated as a closed enum", "Submission.choice"],
  ["Score", "Computed from 0–4 rubric ratings by a fixed formula (0–10000)", "Submission.score"],
  ["Probability", "Confidence in basis points (1–99 %); weights the vote and the settlement", "Submission.probability"],
  ["Parallel decisions", "Five isolated runs, each from its own operator address", "5 × submitBatch"],
  ["Batch decisions", "All answers of an agent in one transaction, one record per question", "Submission per (agent, question)"],
  ["Bounded forks", "Fixed enum plus a per-decision mask; one code path per fork in the vault", "DecisionConfig.allowedForks"],
  ["Action", "Only the fork approved by the engine (or a guardian) executes", "ExecutionVault.execute"],
  ["Verify", "Signed oracle price inside a strict window; hashes recomputed on read", "OutcomeRegistry.resolve"],
];

const GUARANTEES = [
  ["No arbitrary action", "Choices are validated against a closed enum and the decision's fork mask, in the server and in the contract."],
  ["No keys or calldata for the AI", "Keys stay in the execution layer; every call targets a fixed function with arguments built from validated fields."],
  ["No model decides the outcome", "Aggregation and threshold are integer rules; the contract's result is compared with the local one before anything executes."],
  ["No self-settlement", "Rewards and penalties follow from the oracle outcome by fixed rules in OutcomeRegistry."],
  ["Disagreement never moves funds", "Any failed gate — quorum, share or score — approves NO_ACTION."],
  ["Failures are visible", "Timeouts, provider errors, invalid JSON and schema violations are recorded per agent and settled as missed."],
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Protocol"
        title="How DecMarkt works"
        lead="Jev structures the decision. DecMarkt adds accountability. Monad enforces and records the result."
      />

      <Section title="Three layers">
        <ol className="border border-rule bg-surface">
          {LAYERS.map((l) => (
            <li key={l.name} className="grid grid-cols-1 gap-x-8 gap-y-2 border-b border-rule px-5 py-5 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_280px]">
              <div>
                <p className="font-mono text-[11px] text-ink-3">layer {l.n}</p>
                <p className="text-[17px] font-medium">{l.name}</p>
                <p className="text-[13px] text-accent">{l.role}</p>
              </div>
              <p className="text-[13.5px] leading-[21px] text-ink-2">{l.does}</p>
              <dl className="space-y-2 text-[12.5px] md:col-start-2 xl:col-start-auto">
                <div>
                  <dt className="label">Produces</dt>
                  <dd className="mt-0.5">{l.produces}</dd>
                </div>
                <div>
                  <dt className="label">Where</dt>
                  <dd className="mt-0.5 font-mono text-[12px] text-ink-2">{l.code}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="From state to settlement" description="Every stage names the layer and the component responsible. The dashboard and the decision records show these stages with real values.">
        <Pipeline />
      </Section>

      <Section
        title="What is being decided"
        description="An on-chain vault holds test MON in two buckets, ACTIVE and RESERVE. Each round decides whether to move part of it for the next horizon. The correct answer is defined by the reference-market move (ETH/USD) measured from signed Pyth prices — never by opinion."
      >
        <ForkTable />
      </Section>

      <Section title="Lifecycle" description="Enforced by DecisionRegistry. Invalid transitions revert; each reached state records its block and transaction.">
        <LifecycleRail />
      </Section>

      <Section
        title="Jev in the implementation"
        aside={
          <Link href="/docs/jev-integration" className="text-[13px] text-ink-2 hover:text-ink">
            Full mapping →
          </Link>
        }
      >
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
                <Td className="min-w-[300px] text-ink-2">{impl}</Td>
                <Td mono className="whitespace-nowrap">{anchor}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Enforced in code" description="Each property follows from a specific check in the contracts or the server, not from model behaviour.">
        <dl className="grid grid-cols-1 border border-rule bg-surface md:grid-cols-2">
          {GUARANTEES.map(([g, why], i) => (
            <div key={g} className={`border-rule px-5 py-4 ${i % 2 === 0 ? "md:border-r" : ""} ${i > 0 ? "border-t" : ""} ${i === 1 ? "md:border-t-0" : ""}`}>
              <dt className="font-medium">{g}</dt>
              <dd className="mt-1 text-[13px] text-ink-2">{why}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
