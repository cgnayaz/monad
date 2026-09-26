import type { Metadata } from "next";
import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { explorer } from "@/lib/chain/monad";
import { MONAD_TESTNET, PYTH } from "@/lib/config/public";
import { listContracts, pythStatus } from "@/lib/data/contracts";
import { DEFAULT_PARAMS, PARAM_CAPS } from "@/lib/decmarkt/params";
import { formatMon } from "@/lib/format";

export const metadata: Metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

const ROLES = [
  ["DEFAULT_ADMIN_ROLE", "Deployer (testnet)", "Set parameters within hard caps, pause, grant roles"],
  ["PROPOSER_ROLE", "Server proposer key", "Create and open decisions; cancel before aggregation"],
  ["GUARDIAN_ROLE", "Human wallet", "Choose among bounded forks when agents escalate"],
  ["ENGINE_ROLE", "DecisionEngine", "Set AGGREGATED / APPROVED / CANCELLED"],
  ["VAULT_ROLE", "ExecutionVault", "Set EXECUTED"],
  ["OUTCOME_ROLE", "OutcomeRegistry", "Set RESOLVED and apply settlement"],
  ["agent operator", "One address per agent", "Submit for its own agent id only"],
] as const;

export default async function ContractsPage() {
  const [contracts, pyth] = await Promise.all([listContracts(), pythStatus()]);
  const p = DEFAULT_PARAMS;
  const params: [string, string, string][] = [
    ["submissionWindow", `${p.submissionWindowSec} s`, PARAM_CAPS.submissionWindowSec],
    ["horizon", `${p.horizonSec} s`, PARAM_CAPS.horizonSec],
    ["bandBps", `${p.bandBps}`, PARAM_CAPS.bandBps],
    ["thresholdBps", `${p.thresholdBps}`, PARAM_CAPS.thresholdBps],
    ["minActionScore", `${p.minActionScore}`, "—"],
    ["quorum", `${p.quorum} of 5`, PARAM_CAPS.quorum],
    ["lockPerAgent", `${formatMon(p.lockPerAgent)} MON`, "—"],
    ["slashBps", `${p.slashBps}`, PARAM_CAPS.slashBps],
    ["missPenaltyBps", `${p.missPenaltyBps}`, PARAM_CAPS.missPenaltyBps],
    ["roundReward", `${formatMon(p.roundReward)} MON`, "reward pool balance"],
    ["actionBps / maxMove", `${p.actionBps} / ${formatMon(p.maxMove)} MON`, PARAM_CAPS.actionBps],
    ["guardianWindow", `${p.guardianWindowSec} s`, "—"],
    ["resolutionTolerance", `${p.resolutionToleranceSec} s`, "—"],
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${MONAD_TESTNET.name} · chain ${MONAD_TESTNET.id}`}
        title="Contracts"
        lead="Four contracts with separated responsibilities. Status transitions are exclusive to the contract that owns them; execution has no external call path."
      />

      <Section index="01" title="DecMarkt contracts" description="Bytecode presence is checked against the RPC on every request.">
        <Table caption="DecMarkt contracts">
          <thead>
            <tr>
              <Th>Contract</Th>
              <Th>Responsibility</Th>
              <Th>Address</Th>
              <Th>Bytecode</Th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.name}>
                <Td mono className="whitespace-nowrap">{c.name}</Td>
                <Td className="min-w-[260px] text-ink-2">{c.role}</Td>
                <Td>{c.address ? <Hash value={c.address} href={explorer.address(c.address)} /> : <StatusMark tone="neutral">not deployed</StatusMark>}</Td>
                <Td mono>
                  <Avail value={c.code}>{(v) => `${v.bytes.toLocaleString("en-US")} bytes`}</Avail>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section index="02" title="Oracle" description="Pyth is the outcome authority. Values below are read live from Monad Testnet.">
        <Panel>
          <KeyValue
            rows={[
              { k: "Pyth contract", v: <Hash value={pyth.address} href={explorer.address(pyth.address)} full /> },
              { k: "Version", v: <Avail value={pyth.version}>{(v) => <span className="font-mono">{v}</span>}</Avail> },
              { k: "Valid time period", v: <Avail value={pyth.validTimePeriod}>{(v) => `${v} s`}</Avail> },
              { k: "Feed", v: PYTH.feedSymbol },
              { k: "Feed id", v: <Hash value={PYTH.monUsdFeedId} full /> },
            ]}
          />
        </Panel>
      </Section>

      <Section index="03" title="Roles">
        <Table caption="Roles">
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Holder</Th>
              <Th>Can</Th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map(([role, holder, can]) => (
              <tr key={role}>
                <Td mono>{role}</Td>
                <Td>{holder}</Td>
                <Td className="text-ink-2">{can}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section index="04" title="Parameters" description="Deployment defaults. Once deployed, this table reads the live values from the contracts.">
        <Table caption="Parameters">
          <thead>
            <tr>
              <Th>Parameter</Th>
              <Th align="right">Default</Th>
              <Th>Hard cap</Th>
            </tr>
          </thead>
          <tbody>
            {params.map(([k, v, cap]) => (
              <tr key={k}>
                <Td mono>{k}</Td>
                <Td align="right" mono>{v}</Td>
                <Td mono className="text-ink-2">{cap}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}
