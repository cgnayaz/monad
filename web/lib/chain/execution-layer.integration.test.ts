import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestClient, createWalletClient, encodeAbiParameters, http, parseEther, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PYTH } from "@/lib/config/public";
import { getDecisionProvenance } from "@/lib/data/decisions";
import { reproduce } from "@/lib/decmarkt/reproduce";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { AGENTS } from "@/lib/jev/agents";
import { buildState } from "@/lib/jev/state";
import { traceDecision, validateProvenance } from "@/lib/model/provenance";
import { FORKS, type AgentKey } from "@/lib/types/protocol";
import { ScriptedProvider } from "@/test/fixtures/scripted-provider";
import { decisionRegistryAbi, executionVaultAbi } from "./abis";
import { ChainExecutionLayer } from "./execution-layer";
import { monadTestnet } from "./monad";

/**
 * End-to-end: real contracts on anvil, the real TypeScript execution layer, and Pyth's
 * official MockPyth placed at the Pyth address. Only the AI provider is scripted.
 * Run with scripts/integration.sh (anvil development keys only).
 */

const RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL!;
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  proposer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agents: [
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  ],
  keeper: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
} as const satisfies Record<string, Hex | readonly Hex[]>;

const deployments = JSON.parse(readFileSync(join(__dirname, "deployments.10143.json"), "utf8"));
const addr = deployments.contracts;
const test = createTestClient({ chain: monadTestnet, mode: "anvil", transport: http(RPC) }).extend(publicActions);
const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain: monadTestnet, transport: http(RPC) });

const PRICE = { type: "tuple", components: [{ type: "int64" }, { type: "uint64" }, { type: "int32" }, { type: "uint256" }] } as const;
function mockUpdate(price: bigint, publishTime: number): Hex {
  const p = [price, 10n, -8, BigInt(publishTime)] as const;
  return encodeAbiParameters([{ type: "tuple", components: [{ type: "bytes32" }, PRICE, PRICE] }], [[PYTH.monUsdFeedId, p, p]]);
}

const endPrice = 99_000_000n; // −1 % after the horizon
const prices = {
  latest: async () => {
    const t = Number((await test.getBlock()).timestamp);
    return { data: [mockUpdate(100_000_000n, t)], publishTime: t };
  },
  at: async (ts: number) => ({ data: [mockUpdate(endPrice, ts)], publishTime: ts }),
};

beforeAll(async () => {
  const mock = JSON.parse(readFileSync(join(__dirname, "../../../contracts/out/MockPyth.sol/MockPyth.json"), "utf8"));
  await test.setCode({ address: PYTH.contract, bytecode: mock.deployedBytecode.object });

  const admin = wallet(KEYS.deployer);
  for (const [fn, value] of [["deposit", "2"], ["depositActive", "2"]] as const) {
    await test.waitForTransactionReceipt({ hash: await admin.writeContract({ address: addr.ExecutionVault, abi: executionVaultAbi, functionName: fn, value: parseEther(value) }) });
  }
  await test.waitForTransactionReceipt({ hash: await admin.writeContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "fundRewardPool", value: parseEther("1") }) });
  for (let i = 0; i < 5; i++) {
    const w = wallet(KEYS.agents[i]);
    await test.waitForTransactionReceipt({ hash: await w.writeContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "depositBond", args: [i], value: parseEther("1") }) });
  }
});

describe("ChainExecutionLayer on the real contracts", () => {
  it("runs a live round end to end and the chain matches the local deterministic rules", async () => {
    const layer = new ChainExecutionLayer(
      addr,
      { proposer: KEYS.proposer, keeper: KEYS.keeper, agents: Object.fromEntries(AGENTS.map((a, i) => [a.key, KEYS.agents[i] as Hex])) as Record<AgentKey, Hex> },
      prices,
    );
    const now = Number((await test.getBlock()).timestamp);
    const state = buildState(
      { vault: addr.ExecutionVault, asset: "MON", referenceFeed: "MON/USD", horizonSec: 180, bandBps: 10 },
      [
        { key: "market.mon_usd.price", value: 1, unit: "USD", source: "pyth-hermes", observedAt: now, status: "ok" },
        { key: "history.mon_usd.change_1h", value: -40, unit: "bps", source: "pyth-hermes", observedAt: now, status: "ok" },
        { key: "network.block_number", value: "1", source: "monad-rpc", observedAt: now, status: "ok" },
      ],
      now,
    );

    const decision = await runDecisionPipeline({
      collectState: async () => state,
      provider: new ScriptedProvider({ YIELD: { kind: "answer", choice: "NO_ACTION" } }),
      agents: AGENTS,
      params: { submissionWindow: 180, horizon: 180, bandBps: 10, thresholdBps: 6000, minActionScore: 5500, quorum: 4, allowedForks: [...FORKS], lockPerAgent: parseEther("0.05") },
      reputation: await layer.reputation(),
      execution: layer,
    });

    expect(decision.mode).toBe("live");
    expect(decision.decisionId).toBe("1");
    expect(decision.execution).toMatchObject({ status: "submitted", onChainStatus: "EXECUTED", aggregationMatchesChain: true, submissionErrors: [] });
    if (decision.execution.status === "submitted") {
      expect(decision.execution.transactions.map((t) => t.functionName)).toEqual([
        "createDecision", "openDecision", "submitBatch", "submitBatch", "submitBatch", "submitBatch", "submitBatch", "aggregate", "execute",
      ]);
    }

    // Too early: the layer refuses rather than sending a transaction that must revert.
    await expect(layer.resolve("1")).rejects.toThrow(/Horizon not reached/);
    await test.increaseTime({ seconds: 200 });
    await test.mine({ blocks: 1 });
    const step = await layer.advance("1");
    expect(step).toMatchObject({ step: "resolve", status: "RESOLVED" });

    const res = await getDecisionProvenance(1n);
    expect(res.status).toBe("ok");
    if (res.status !== "ok" || !res.value) throw new Error("provenance unavailable");
    const p = res.value;
    expect(p.decision.status).toBe("RESOLVED");
    expect(p.decision.stateHash).toBe(state.hash);
    expect(p.submissions).toHaveLength(10); // 5 agents × 2 questions, each its own on-chain record
    expect(p.aggregation?.supportShareBps).toBe(decision.aggregation.supportShareBps);
    expect(p.aggregation?.aggregateScore).toBe(decision.aggregateScore);
    expect(p.action).toMatchObject({ fork: "DERISK", approvedBy: "engine" });
    expect(p.outcome).toMatchObject({ expectedAction: "DERISK", success: true, status: "VERIFIED" });
    expect(p.settlement?.settlementStatus).toBe("SETTLED");
    expect(p.settlement?.lines.find((l) => l.agentId === 1)?.result).toBe("WRONG");

    // Attach the off-chain payloads and check every link of the chain.
    const full = { ...p, state, questions: decision.questions, parallel: decision.parallel };
    expect(validateProvenance(full)).toEqual([]);
    expect(traceDecision(full, 0).every((s) => s.status === "present")).toBe(true);
    expect(p.decision.transitions.map((t) => t.tx?.functionName)).toEqual(["createDecision", "openDecision", "aggregate", "aggregate", "execute", "resolve"]);

    expect(await layer.advance("1")).toMatchObject({ step: "none", status: "RESOLVED" });

    // The settlement recorded by OutcomeRegistry is exactly what the deterministic rules give.
    const repro = reproduce(p, { slashBps: 3000, missPenaltyBps: 1000 });
    expect(repro?.matches).toBe(true);
    expect(repro?.outcome?.correctFork).toBe(p.outcome?.observedResult?.correctFork);
  });
});
