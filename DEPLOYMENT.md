# Deployment

## 1. Network facts

| | Value | Status |
|---|---|---|
| Chain | Monad Testnet, id `10143` | verified 2026-09-26 |
| RPC | `https://testnet-rpc.monad.xyz` | verified |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` (v1.4.6) | verified |
| Reference feed ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | verified via Hermes; the key is not entitled to MON/USD (403) |
| Hermes | `https://pyth.dourolabs.app/hermes` + `PYTH_API_KEY` (Bearer) | key required since 2026-08-26; old host returns 401 for price updates |
| Pyth testnet contract accepts post-upgrade update format and `parsePriceFeedUpdatesUnique` | — | verified: `web/scripts/fork-pyth.sh` (fork test against the live deployment) |
| Explorer | `https://testnet.monadexplorer.com` | used for links |
| Source verification | Sourcify, `https://sourcify-api-monad.blockvision.org` | verified: all four contracts exact match |
| Faucet | `https://faucet.monad.xyz` | to verify limits |
| `eth_getLogs` range limit | — | to verify; UI queries exact blocks only |

Monad specifics to respect:
- Gas is charged on the **gas limit**, not gas used — keep limits tight (RPC estimate + ~10 %).
- Cold storage writes cost more than in a local EVM simulation. Forge's simulated estimate
  was too low for `depositActive` (out of gas); scripts that write storage should use
  `--skip-simulation` so the RPC estimates gas.
- Several back-to-back value transfers from one account can fail at execution (Monad's
  asynchronous execution / reserve-balance check) although they simulate fine. `Setup.s.sol`
  is idempotent, so re-running it sends only what is missing; spacing transfers a few
  seconds apart avoids the failure.

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

### Deploy + setup (Monad Testnet)

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast   # contracts, roles, agents → deployments JSON
forge script script/Setup.s.sol  --rpc-url monad_testnet --broadcast   # vault 1+1 MON, reward pool 0.5, bonds 5×0.5, gas for operators
cd ../web && node scripts/sync-abis.mjs
```

`contracts/.env` holds the deployer key and the public addresses; `web/.env.local` holds the
proposer, keeper and agent keys. `GUARDIAN_ADDRESS` and `ADMIN_ADDRESS` are the operator's
own browser wallet, which can then act as guardian and admin from the UI. Budget: ≈ 8 MON
(≈ 1.3 deployment gas, 2 vault, 0.5 reward pool, 2.5 bonds, 1.8 operator gas).

## 4. Web (Vercel)

Project settings: **Root Directory `web`**, framework Next.js (auto-detected), Node 24,
build `next build` (default). No `vercel.json` is needed.

Environment variables — the full annotated list is [web/.env.example](web/.env.example):

| Variable | Kind | Needed for |
|---|---|---|
| `NEXT_PUBLIC_MONAD_RPC_URL` | public (optional) | browser + server RPC; default `https://testnet-rpc.monad.xyz` |
| `AI_PROVIDER` | config (optional) | `gemini` or `anthropic` (case-insensitive); default `gemini`, `anthropic` only when `ANTHROPIC_API_KEY` is the only key set |
| `GEMINI_API_KEY` | secret | every round (simulation and live) with the Gemini provider; `GOOGLE_API_KEY` is accepted as an alias. Verify with `cd web && npm run gemini:check` |
| `AI_MODEL`, `AI_FALLBACK_MODEL` | config (optional) | Gemini defaults `gemini-3.8-flash`, fallbacks `gemini-3.7-flash,gemini-3.6-flash` |
| `ANTHROPIC_API_KEY` | secret (optional) | only with `AI_PROVIDER=anthropic` (default model `claude-opus-5`); the account needs credit |
| `PYTH_API_KEY`, `PYTH_HERMES_URL` | secret / config | signed prices (execute, resolve, verification); key entitled to ETH/USD |
| `SESSION_SECRET` | secret, ≥ 32 chars | operator sign-in; live mode is off without it (derived from `SIGNER_SEED` when unset) |
| `SIGNER_SEED` | secret, ≥ 32 chars | alternative to the seven signer keys below: each missing `*_PRIVATE_KEY` is derived from it (`keccak256("decmarkt/v1/<role>/<seed>")`). Register the derived operators once on `/kurulum` (admin wallet: register 5 agents in role order → ids 5–9, grant PROPOSER_ROLE, fund the proposer; the server then deposits bonds and gas). `agentId % 5` maps any generation back to its role |
| `PROPOSER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `AGENT_{RISK,YIELD,SECURITY,MARKET,HISTORY}_PRIVATE_KEY` | secret | live mode; must match the addresses in contracts/DEPLOYMENTS.md |
| `BLOB_READ_WRITE_TOKEN` | secret | payload store (state, questions, reasons); created by connecting a Vercel Blob store |

Only `NEXT_PUBLIC_MONAD_RPC_URL` reaches the browser. Chain id, explorer, contract addresses
and the Pyth contract/feed are committed (`web/lib/chain/deployments.10143.json`,
`web/lib/config/public.ts`) and were checked against the chain on 2026-09-26. Empty variables
count as not configured; surrounding quotes and whitespace are stripped, and a malformed value is
ignored and named on the dashboard instead of failing the server. The dashboard shows which mode (live / simulation / unavailable) the
deployment can run and why.

Runtime notes:
- `POST /api/decisions` streams one round up to submission/aggregation (`maxDuration` 300 s:
  state collection, ≤ 60 s agent timeout, transactions). Later lifecycle steps are separate
  calls (`/advance`, or any wallet on the decision page), so no invocation waits for the horizon.
- One running round per instance; rate limits are per instance (SECURITY_AUDIT.md L-4).
- Without `BLOB_READ_WRITE_TOKEN` in production, rounds still run and hashes are on chain,
  but reasons cannot be shown; the round reports "payload store not configured".

```bash
cd web && npm run check          # typecheck, lint, tests, production build — must pass
vercel link                      # once; set Root Directory to web
vercel env add <NAME> production # for each secret above (or in the dashboard)
vercel --prod
```

## 5. End-to-end test on a local chain

`web/scripts/integration.sh` starts anvil (chain id 10143), deploys the contracts with the
real deploy script, places Pyth's official MockPyth at the Pyth address and runs the real
TypeScript execution layer through a full round (commit → 5 × submitBatch → aggregate →
execute → resolve), then checks the provenance read layer. Only the AI provider is scripted.
The deployments file is restored afterwards. Uses anvil's public development keys.

## 6. Release checklist

- [ ] `forge test` green (unit + fuzz); `web/scripts/fork-pyth.sh` passes against the live deployment.
- [ ] `guvenlik-denetcisi` review; findings fixed or documented in SECURITY_AUDIT.md.
- [ ] `git ls-files` contains no `.env*` besides `.env.example`; no private keys in history.
- [ ] Contracts source-verified; addresses in `/contracts` match explorer.
- [ ] One full real round resolved on the production deployment.
- [ ] README links: live URL, repo, contract addresses, demo video.
