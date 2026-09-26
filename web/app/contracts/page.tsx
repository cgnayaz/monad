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

export const metadata: Metadata = { title: "Kontratlar" };
export const dynamic = "force-dynamic";

const ROLES = [
  ["DEFAULT_ADMIN_ROLE", "Dağıtıcı ve operatör cüzdanı", "Parametreleri sert sınırlar içinde ayarlar, duraklatır, rol verir; yalnızca duraklatılmışken çekim yapar"],
  ["PROPOSER_ROLE", "Sunucu proposer anahtarı", "Karar oluşturur ve açar; toplamadan önce iptal eder"],
  ["GUARDIAN_ROLE", "İnsan cüzdanı", "Ajanlar yükselttiğinde sınırlı bir eylem seçer"],
  ["ENGINE_ROLE", "DecisionEngine", "OPEN → AGGREGATED → APPROVED; yeter sayı yoksa CANCELLED"],
  ["VAULT_ROLE", "ExecutionVault", "APPROVED → EXECUTED"],
  ["OUTCOME_ROLE", "OutcomeRegistry", "Uzlaşmayı uygular ve EXECUTED → RESOLVED"],
  ["ajan operatörü", "Ajan başına bir adres", "Kendi ajan kimliği için submit / submitBatch; serbest teminatını çeker"],
] as const;

export default async function ContractsPage() {
  const [contracts, pyth, net, live] = await Promise.all([listContracts(), pythStatus(), networkStatus(), liveParameters()]);
  const d = deployment();

  return (
    <>
      <PageHeader
        eyebrow="Monad yürütme ve uzlaşma katmanı"
        title="Kontratlar"
        lead="Sorumlulukları ayrılmış dört kontrat. Her yaşam döngüsü geçişi tam olarak birine aittir; kasanın dış çağrı yolu yoktur. Aşağıdaki her adres ve değer her istekte ağdan okunur."
      />

      <div className="mb-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Ağ">
          <KeyValue
            rows={[
              { k: "Ağ", v: MONAD_TESTNET.name },
              { k: "Zincir kimliği", v: <Avail value={net.chainId}>{(id) => <span className="font-mono">{id}{id !== MONAD_TESTNET.id && <span className="text-fail"> (beklenen {MONAD_TESTNET.id})</span>}</span>}</Avail> },
              { k: "Son blok", v: <Avail value={net.blockNumber}>{(b) => <a className="font-mono underline decoration-rule underline-offset-2 hover:decoration-ink" href={explorer.block(b)} target="_blank" rel="noreferrer">{b.toLocaleString("en-US")}</a>}</Avail> },
              { k: "RPC", v: <span className="font-mono text-[12.5px]">{MONAD_TESTNET.rpcUrl}</span> },
              { k: "Gezgin", v: <a className="text-[12.5px] underline decoration-rule underline-offset-2 hover:decoration-ink" href={MONAD_TESTNET.explorerUrl} target="_blank" rel="noreferrer">{MONAD_TESTNET.explorerUrl.replace("https://", "")}</a> },
            ]}
          />
        </Panel>
        <Panel title="Dağıtım">
          <KeyValue
            rows={[
              { k: "Durum", v: <StatusMark tone={d.deployed ? "pass" : "neutral"}>{d.deployed ? "dağıtıldı" : "dağıtılmadı"}</StatusMark> },
              { k: "Dağıtım bloğu", v: d.deployed ? <span className="font-mono">{d.deployBlock.toString()}</span> : <span className="text-ink-3">—</span> },
              { k: "Kaynak", v: <a className="text-[12.5px] underline decoration-rule underline-offset-2 hover:decoration-ink" href={`${REPO_URL}/tree/main/contracts/src`} target="_blank" rel="noreferrer">contracts/src</a> },
              { k: "Araç zinciri", v: <span className="text-[12.5px]">Solidity 0.8.28 · Foundry · OpenZeppelin 5.4 · Pyth SDK 2.2</span> },
              ...(!d.deployed ? [{ k: "Eksik", v: <span className="font-mono text-[12.5px] text-ink-2">{d.missing.join(", ")}</span> }] : []),
            ]}
          />
        </Panel>
        <WalletRoles />
      </div>

      <Section title="DecMarkt kontratları" description="Her adres için bytecode varlığı RPC üzerinden kontrol edilir.">
        <Table caption="DecMarkt kontratları">
          <thead>
            <tr>
              <Th>Kontrat</Th>
              <Th>Sorumluluk</Th>
              <Th>Adres</Th>
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
                <Td>{c.address ? <Hash value={c.address} href={explorer.address(c.address)} /> : <StatusMark tone="neutral">dağıtılmadı</StatusMark>}</Td>
                <Td mono>
                  <Avail value={c.code}>{(v) => `${v.bytes.toLocaleString("en-US")} bayt`}</Avail>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Oracle" description="Sonuç otoritesi Pyth'tir. Monad Testnet'ten canlı okunur.">
        <div className="max-w-[760px]">
          <Panel>
            <KeyValue
              rows={[
                { k: "Pyth kontratı", v: <Hash value={pyth.address} href={explorer.address(pyth.address)} full /> },
                { k: "Sürüm", v: <Avail value={pyth.version}>{(v) => <span className="font-mono">{v}</span>}</Avail> },
                { k: "Geçerlilik süresi", v: <Avail value={pyth.validTimePeriod}>{(v) => `${v} s`}</Avail> },
                { k: "Besleme", v: PYTH.feedSymbol },
                { k: "Besleme kimliği", v: <Hash value={PYTH.feedId} /> },
              ]}
            />
          </Panel>
        </div>
      </Section>

      <Section title="Roller">
        <Table caption="Roller">
          <thead>
            <tr>
              <Th>Rol</Th>
              <Th>Sahibi</Th>
              <Th>Yetkisi</Th>
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
        title="Parametreler"
        description={live.status === "ok" ? "Yöneticinin belirlediği değerler, şu an zincirde oldukları haliyle; karar başına değerler karar oluşturulurken sabitlenir." : "Dağıtım betiğindeki varsayılanlar. Henüz zincirde değil."}
      >
        <Table caption="Parametreler">
          <thead>
            <tr>
              <Th>Parametre</Th>
              <Th align="right">{live.status === "ok" ? "Zincirde" : "Varsayılan"}</Th>
              <Th>Sert sınır</Th>
              <Th>Nerede</Th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["thresholdBps", `${DEFAULT_PARAMS.thresholdBps}`, PARAM_CAPS.thresholdBps, "karar başına"],
                ["quorum", `5 üzerinden ${DEFAULT_PARAMS.quorum}`, PARAM_CAPS.quorum, "karar başına"],
                ["minActionScore", `${DEFAULT_PARAMS.minActionScore}`, "≤ 10000", "karar başına"],
                ["submissionWindow · horizon", `${DEFAULT_PARAMS.submissionWindowSec} s · ${DEFAULT_PARAMS.horizonSec} s`, `${PARAM_CAPS.submissionWindowSec} · ${PARAM_CAPS.horizonSec}`, "karar başına"],
                ["bandBps", `${DEFAULT_PARAMS.bandBps}`, PARAM_CAPS.bandBps, "karar başına"],
                ["lockPerAgent", `${formatMon(DEFAULT_PARAMS.lockPerAgent, 2)} MON`, "> 0", "karar başına"],
                ["roundReward", live.status === "ok" ? `${formatMon(live.value.roundReward, 3)} MON` : `${formatMon(DEFAULT_PARAMS.roundReward, 3)} MON`, "ödül havuzu", "DecisionRegistry"],
                ["slashBps · missPenaltyBps", live.status === "ok" ? `${live.value.slashBps} · ${live.value.missPenaltyBps}` : `${DEFAULT_PARAMS.slashBps} · ${DEFAULT_PARAMS.missPenaltyBps}`, `${PARAM_CAPS.slashBps} · ${PARAM_CAPS.missPenaltyBps}`, "OutcomeRegistry"],
                ["actionBps · maxMove", live.status === "ok" ? `${live.value.actionBps} · ${formatMon(live.value.maxMove, 2)} MON` : `${DEFAULT_PARAMS.actionBps} · ${formatMon(DEFAULT_PARAMS.maxMove, 2)} MON`, PARAM_CAPS.actionBps, "ExecutionVault"],
                ...(live.status === "ok"
                  ? ([
                      ["ödül havuzu", `${formatMon(live.value.rewardPool, 3)} MON`, "—", "DecisionRegistry"],
                      ["kasa ACTIVE · RESERVE", `${formatMon(live.value.vault.active, 3)} · ${formatMon(live.value.vault.reserve, 3)} MON`, "—", "ExecutionVault"],
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
