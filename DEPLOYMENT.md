# Deployment

## 1. Network facts

| | Value | Status |
|---|---|---|
| Chain | Monad Testnet, id `10143` | verified 2026-09-26 |
| RPC | `https://testnet-rpc.monad.xyz` | verified |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` (v1.4.6) | verified |
| MON/USD feed | `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1` | verified via Hermes |
| Hermes | `https://pyth.dourolabs.app/hermes` + `PYTH_API_KEY` (Bearer) | key required since 2026-08-26; old host returns 401 for price updates |
| Pyth testnet contract accepts post-upgrade update format | — | to verify with a fork test before contract deploy |
| Explorer | `https://testnet.monadexplorer.com` | to verify |
| Source verification | Sourcify / explorer API | to verify |
| Faucet | `https://faucet.monad.xyz` | to verify limits |
| `eth_getLogs` range limit | — | to verify; UI queries exact blocks only |

Monad specifics to respect: gas is charged on the **gas limit**, not gas used — set
explicit, tight gas limits from `estimateGas` × 1.2 instead of large defaults.

## 2. Keys and funding (testnet only)

| Key | Env name | Needs |
|---|---|---|
| Deployer / admin | `DEPLOYER_PRIVATE_KEY` (contracts/.env) | gas for deploy |
| Proposer | `PROPOSER_PRIVATE_KEY` | gas |
| 5 agent operators | `AGENT_{RISK,YIELD,SECURITY,MARKET,HISTORY}_PRIVATE_KEY` | gas + bond (≥ 0.25 MON each) |
| Keeper (aggregate/execute/resolve) | `KEEPER_PRIVATE_KEY` | gas + Pyth fees |
| Guardian | browser wallet | gas |

Treasury: vault ≥ 2 MON. Reward pool ≥ 0.2 MON.

## 3. Contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts pyth-network/pyth-sdk-solidity
forge build && forge test -vv
forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --broadcast
```

`Deploy.s.sol`: deploys the four contracts, grants `ENGINE_ROLE`/`VAULT_ROLE`/`OUTCOME_ROLE`
to contract addresses, `PROPOSER_ROLE` and `GUARDIAN_ROLE` to configured addresses,
registers the five agents, and writes `web/lib/chain/deployments.10143.json`
(addresses + deploy block). `contracts/DEPLOYMENTS.md` is updated with explorer links.

Post-deploy (script `Setup.s.sol`): bond each agent from its own key, fund vault and
reward pool, run one smoke round.

## 4. Web (Vercel)

- Root directory: `web/`. Framework: Next.js. Node 24.
- Server env (never `NEXT_PUBLIC_`): `ANTHROPIC_API_KEY`, `AI_MODEL`, `PYTH_API_KEY`, `PYTH_HERMES_URL`, `PROPOSER_PRIVATE_KEY`,
  `AGENT_*_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `BLOB_READ_WRITE_TOKEN`, `DEMO_RATE_LIMIT`.
- Public env: `NEXT_PUBLIC_MONAD_RPC_URL` (optional), contract addresses come
  from the committed deployments JSON.
- Round endpoints set `maxDuration` within the plan's limit; each call does one lifecycle
  step, so no single invocation waits for all stages.
- Payload store: Vercel Blob (public read, server write).

```bash
cd web && npm run build          # must pass locally
vercel link && vercel env pull   # once
vercel --prod
```

## 5. End-to-end test on a local chain

`web/scripts/integration.sh` starts anvil (chain id 10143), deploys the contracts with the
real deploy script, places Pyth's official MockPyth at the Pyth address and runs the real
TypeScript execution layer through a full round (commit → 5 × submitBatch → aggregate →
execute → resolve), then checks the provenance read layer. Only the AI provider is scripted.
The deployments file is restored afterwards. Uses anvil's public development keys.

## 6. Release checklist

- [ ] `forge test` green, invariants fuzzed.
- [ ] `guvenlik-denetcisi` review; findings fixed or documented in SECURITY_MODEL.md.
- [ ] `git ls-files` contains no `.env*` besides `.env.example`; no private keys in history.
- [ ] Contracts source-verified; addresses in `/contracts` match explorer.
- [ ] One full real round resolved on the production deployment.
- [ ] README links: live URL, repo, contract addresses, demo video.
