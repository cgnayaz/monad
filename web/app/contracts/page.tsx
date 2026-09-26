import type { Metadata } from "next";
import { Avail } from "@/components/ui/availability";
import { Hash } from "@/components/ui/hash";
import { KeyValue, PageHeader, Panel, Section } from "@/components/ui/layout";
import { StatusMark } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { WalletRoles } from "@/components/wallet/wallet-roles";
import { deployment } from "@/lib/chain/deployments";
import { explorer } from "@/lib/chain/monad";
import { MONAD_TESTNET, PYTH, REPO_URL } from "@/lib/config/public";
import { listContracts, liveParameters, networkStatus, pythStatus } from "@/lib/data/contracts";
import { DEFAULT_PARAMS, PARAM_CAPS } from "@/lib/decmarkt/params";
import { formatMon } from "@/lib/format";

export const metadata: Metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

const ROLES = [
  ["DEFAULT_ADMIN_ROLE", "Deployer (testnet)", "Set parameters within hard caps, pause, grant roles"],
  ["PROPOSER_ROLE", "Server proposer key", "Create and open decisions; cancel before aggregation"],
  ["GUARDIAN_ROLE", "Human wallet", "Choose a bounded action when agents escalate"],
  ["ENGINE_ROLE", "DecisionEngine", "OPEN → AGGREGATED → APPROVED, or CANCELLED on missing quorum"],
  ["VAULT_ROLE", "ExecutionVault", "APPROVED → EXECUTED"],
  ["OUTCOME_ROLE", "OutcomeRegistry", "Apply settlement and EXECUTED → RESOLVED"],
  ["agent operator", "One address per agent", "submit / submitBatch for its own agent id; withdraw its free bond"],
] as const;

export default async function ContractsPage() {
  const [contracts, pyth, net, live] = await Promise.all([listContracts(), pythStatus(), networkStatus(), liveParameters()]);
  const d = deployment();

  return (
    <>
      <PageHeader
        eyebrow="Monad execution & settlement layer"
        title="Contracts"
        lead="Four contracts with separated responsibilities. Each lifecycle transition belongs to exactly one of them; the vault has no external call path. Every address and value below is read from the network on each request."
      />

      <div className="mb-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Network">
          <KeyValue
            rows={[
              { k: "Network", v: MONAD_TESTNET.name },
              { k: "Chain id", v: <Avail value={net.chainId}>{(id) => <span className="font-mono">{id}{id !== MONAD_TESTNET.id && <span className="text-fail"> (expected {MONAD_TESTNET.id})</span>}</span>}</Avail> },
              { k: "Latest block", v: <Avail value={net.blockNumber}>{(b) => <a className="font-mono underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.block(b)} target="_blank" rel="noreferrer">{b.toLocaleString("en-US")}</a>}</Avail> },
              { k: "RPC", v: <span className="font-mono text-[12.5px]">{MONAD_TESTNET.rpcUrl}</span> },
              { k: "Explorer", v: <a className="text-[12.5px] underline decoration-rule underline-offset-2 hover:decoration-ink" href={MONAD_TESTNET.explorerUrl} target="_blank" rel="noreferrer">{MONAD_TESTNET.explorerUrl.replace("https://", "")}</a> },
            ]}
          />
        </Panel>
        <Panel title="Deployment">
          <KeyValue
            rows={[
              { k: "Status", v: <StatusMark tone={d.deployed ? "pass" : "neutral"}>{d.deployed ? "deployed" : "not deployed"}</StatusMark> },
              { k: "Deploy block", v: d.deployed ? <span className="font-mono">{d.deployBlock.toString()}</span> : <span className="text-ink-3">—</span> },
              { k: "Source", v: <a className="text-[12.5px] underline decoration-rule underline-offset-2 hover:decoration-ink" href={`${REPO_URL}/tree/main/contracts/src`} target="_blank" rel="noreferrer">contracts/src</a> },
              { k: "Toolchain", v: <span className="text-[12.5px]">Solidity 0.8.28 · Foundry · OpenZeppelin 5.4 · Pyth SDK 2.2</span> },
              ...(!d.deployed ? [{ k: "Missing", v: <span className="font-mono text-[12.5px] text-ink-2">{d.missing.join(", ")}</span> }] : []),
            ]}
          />
        </Panel>
        <WalletRoles />
      </div>

      <Section title="DecMarkt contracts" description="Bytecode presence is checked against the RPC for every address.">
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
                <Td className="whitespace-nowrap">
                  <a className="font-mono underline decoration-rule underline-offset-2 hover:decoration-ink" href={`${REPO_URL}/blob/main/contracts/src/${c.name}.sol`} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>
                </Td>
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

      <Section title="Oracle" description="Pyth is the outcome authority. Read live from Monad Testnet.">
        <div className="max-w-[760px]">
          <Panel>
            <KeyValue
              rows={[
                { k: "Pyth contract", v: <Hash value={pyth.address} href={explorer.address(pyth.address)} full /> },
                { k: "Version", v: <Avail value={pyth.version}>{(v) => <span className="font-mono">{v}</span>}</Avail> },
                { k: "Valid time period", v: <Avail value={pyth.validTimePeriod}>{(v) => `${v} s`}</Avail> },
                { k: "Feed", v: PYTH.feedSymbol },
                { k: "Feed id", v: <Hash value={PYTH.monUsdFeedId} /> },
              ]}
            />
          </Panel>
        </div>
      </Section>

      <Section title="Roles">
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
                <Td mono className="whitespace-nowrap">{role}</Td>
                <Td className="whitespace-nowrap">{holder}</Td>
                <Td className="text-ink-2">{can}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section
        title="Parameters"
        description={live.status === "ok" ? "Admin-set values as they are on-chain now; per-decision values are fixed when a decision is created." : "Deployment defaults from the deploy script. Not on-chain yet."}
      >
        <Table caption="Parameters">
          <thead>
            <tr>
              <Th>Parameter</Th>
              <Th align="right">{live.status === "ok" ? "On-chain" : "Default"}</Th>
              <Th>Hard cap</Th>
              <Th>Where</Th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["thresholdBps", `${DEFAULT_PARAMS.thresholdBps}`, PARAM_CAPS.thresholdBps, "per decision"],
                ["quorum", `${DEFAULT_PARAMS.quorum} of 5`, PARAM_CAPS.quorum, "per decision"],
                ["minActionScore", `${DEFAULT_PARAMS.minActionScore}`, "≤ 10000", "per decision"],
                ["submissionWindow · horizon", `${DEFAULT_PARAMS.submissionWindowSec} s · ${DEFAULT_PARAMS.horizonSec} s`, `${PARAM_CAPS.submissionWindowSec} · ${PARAM_CAPS.horizonSec}`, "per decision"],
                ["bandBps", `${DEFAULT_PARAMS.bandBps}`, PARAM_CAPS.bandBps, "per decision"],
                ["lockPerAgent", `${formatMon(DEFAULT_PARAMS.lockPerAgent, 2)} MON`, "> 0", "per decision"],
                ["roundReward", live.status === "ok" ? `${formatMon(live.value.roundReward, 3)} MON` : `${formatMon(DEFAULT_PARAMS.roundReward, 3)} MON`, "reward pool", "DecisionRegistry"],
                ["slashBps · missPenaltyBps", live.status === "ok" ? `${live.value.slashBps} · ${live.value.missPenaltyBps}` : `${DEFAULT_PARAMS.slashBps} · ${DEFAULT_PARAMS.missPenaltyBps}`, `${PARAM_CAPS.slashBps} · ${PARAM_CAPS.missPenaltyBps}`, "OutcomeRegistry"],
                ["actionBps · maxMove", live.status === "ok" ? `${live.value.actionBps} · ${formatMon(live.value.maxMove, 2)} MON` : `${DEFAULT_PARAMS.actionBps} · ${formatMon(DEFAULT_PARAMS.maxMove, 2)} MON`, PARAM_CAPS.actionBps, "ExecutionVault"],
                ...(live.status === "ok"
                  ? ([
                      ["reward pool", `${formatMon(live.value.rewardPool, 3)} MON`, "—", "DecisionRegistry"],
                      ["vault ACTIVE · RESERVE", `${formatMon(live.value.vault.active, 3)} · ${formatMon(live.value.vault.reserve, 3)} MON`, "—", "ExecutionVault"],
                    ] as const)
                  : []),
              ] as const
            ).map(([k, v, cap, where]) => (
              <tr key={k}>
                <Td mono>{k}</Td>
                <Td align="right" mono>{v}</Td>
                <Td mono className="text-ink-2">{cap}</Td>
                <Td className="text-ink-2">{where}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}
