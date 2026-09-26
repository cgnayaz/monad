/**
 * LOCAL DEVELOPMENT ONLY — seeds an anvil chain (see scripts/local-chain.sh) with real
 * rounds run through the real pipeline, execution layer and contracts, so every screen can
 * be reviewed in its populated states. The AI provider is scripted; nothing here is used
 * by the application or deployed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClient, createWalletClient, encodeAbiParameters, http, parseEther, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProviderError } from "@/lib/ai/provider";
import { decisionRegistryAbi, executionVaultAbi } from "@/lib/chain/abis";
import { ChainExecutionLayer } from "@/lib/chain/execution-layer";
import { monadTestnet } from "@/lib/chain/monad";
import { collectState } from "@/lib/collectors";
import { PYTH } from "@/lib/config/public";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { AGENTS } from "@/lib/jev/agents";
import { payloadStore } from "@/lib/store/payload-store";
import { FORKS, type AgentKey } from "@/lib/types/protocol";
import { ScriptedProvider } from "@/test/fixtures/scripted-provider";

const RPC = process.env.NEXT_PUBLIC_MONAD_RPC_URL!;
const K = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  proposer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  keeper: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  agents: [
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  ],
} as const;

const addr = JSON.parse(readFileSync(join(__dirname, "../lib/chain/deployments.10143.json"), "utf8")).contracts;
const chain = createTestClient({ chain: monadTestnet, mode: "anvil", transport: http(RPC) }).extend(publicActions);
const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain: monadTestnet, transport: http(RPC) });
const P = { type: "tuple", components: [{ type: "int64" }, { type: "uint64" }, { type: "int32" }, { type: "uint256" }] } as const;
const update = (price: bigint, t: number): Hex => {
  const p = [price, 12_000n, -8, BigInt(t)] as const;
  return encodeAbiParameters([{ type: "tuple", components: [{ type: "bytes32" }, P, P] }], [[PYTH.feedId, p, p]]);
};
const uniqueUpdate = (price: bigint, t: number): Hex => {
  const p = [price, 12_000n, -8, BigInt(t)] as const;
  return encodeAbiParameters([{ type: "tuple", components: [{ type: "bytes32" }, P, P] }, { type: "uint64" }], [[PYTH.feedId, p, p], BigInt(t - 1)]);
};
let end = 3_458_000n;
const prices = {
  latest: async () => {
    const t = Number((await chain.getBlock()).timestamp);
    return { data: [update(3_471_000n, t)], publishTime: t };
  },
  at: async (t: number) => ({ data: [uniqueUpdate(end, t)], publishTime: t }),
};

it("seeds a local chain with real rounds", async () => {
  const mock = JSON.parse(readFileSync(join(__dirname, "../../contracts/out/MockPythUnique.sol/MockPythUnique.json"), "utf8"));
  await chain.setCode({ address: PYTH.contract, bytecode: mock.deployedBytecode.object });
  const admin = wallet(K.deployer);
  const send = async (h: Promise<Hex>) => chain.waitForTransactionReceipt({ hash: await h });
  await send(admin.writeContract({ address: addr.ExecutionVault, abi: executionVaultAbi, functionName: "deposit", value: parseEther("2") }));
  await send(admin.writeContract({ address: addr.ExecutionVault, abi: executionVaultAbi, functionName: "depositActive", value: parseEther("2") }));
  await send(admin.writeContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "fundRewardPool", value: parseEther("1") }));
  for (let i = 0; i < 5; i++) {
    await send(wallet(K.agents[i]).writeContract({ address: addr.DecisionRegistry, abi: decisionRegistryAbi, functionName: "depositBond", args: [i], value: parseEther("1") }));
  }

  const layer = new ChainExecutionLayer(
    addr,
    { proposer: K.proposer, keeper: K.keeper, agents: Object.fromEntries(AGENTS.map((a, i) => [a.key, K.agents[i] as Hex])) as Record<AgentKey, Hex> },
    prices,
  );
  const params = { submissionWindow: 180, horizon: 180, bandBps: 10, thresholdBps: 6000, minActionScore: 5500, quorum: 4, allowedForks: [...FORKS], lockPerAgent: parseEther("0.05") };
  const run = async (provider: ScriptedProvider) =>
    runDecisionPipeline({ collectState, provider, agents: AGENTS, params, reputation: await layer.reputation(), execution: layer, payloads: payloadStore().store });

  // Round 1: one agent fails (invalid JSON) → aggregation after the deadline → executed → resolved.
  const r1 = await run(
    new ScriptedProvider({
      YIELD: { kind: "answer", choice: "NO_ACTION", probability: 5800, rating: 2 },
      HISTORY: { kind: "text", text: "The historical record is thin; I lean towards de-risking." },
      MARKET: { kind: "answer", choice: "DERISK", probability: 6600 },
    }),
  );
  await chain.increaseTime({ seconds: 200 });
  await chain.mine({ blocks: 1 });
  expect((await layer.advance(r1.decisionId)).status).toBe("APPROVED");
  expect((await layer.advance(r1.decisionId)).status).toBe("EXECUTED");
  await chain.increaseTime({ seconds: 200 });
  await chain.mine({ blocks: 1 });
  expect((await layer.advance(r1.decisionId)).status).toBe("RESOLVED");

  // Round 2: all agents decide; executed; outcome pending.
  end = 3_490_000n;
  await chain.increaseTime({ seconds: 60 });
  await chain.mine({ blocks: 1 });
  const r2 = await run(
    new ScriptedProvider({
      RISK: { kind: "answer", choice: "NO_ACTION", probability: 6100 },
      YIELD: { kind: "answer", choice: "DEPLOY", probability: 6400 },
      SECURITY: { kind: "throw", error: new ProviderError("timeout", "No response within 60000 ms") },
      MARKET: { kind: "answer", choice: "DEPLOY", probability: 7100 },
      HISTORY: { kind: "answer", choice: "DEPLOY", probability: 5600, rating: 3 },
    }),
  );
  await chain.increaseTime({ seconds: 200 });
  await chain.mine({ blocks: 1 });
  await layer.advance(r2.decisionId); // aggregate after the deadline
  await layer.advance(r2.decisionId); // execute
}, 180_000);
