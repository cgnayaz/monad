# DecMarkt — AI decisions with on-chain accountability

**Jev structures decisions. DecMarkt makes those decisions accountable. Monad executes and records the result.**

Five independent AI analysts evaluate the same hashed state. Each answers explicit questions with a
*choice* from a closed set, rubric ratings that produce a *score*, and a *probability*. Every analyst is an
on-chain identity with a bond. Fixed integer rules aggregate the answers and apply a threshold. Only one of
four predefined actions can execute. The outcome is measured from signed Pyth prices, and each bond is
rewarded or penalised against that outcome. No model decides the outcome or the settlement.

Everything runs on **Monad Testnet** (chain 10143). Live app: **https://decmarkt.vercel.app**

## How a round works

| Stage | Layer | What happens | Where |
|---|---|---|---|
| State | Jev | Inputs from Pyth, the Monad RPC and the contracts; canonical JSON, hashed | `web/lib/collectors`, `web/lib/jev/state.ts` |
| Questions | Jev | Six explicit questions with ids, rubric and the inputs each one uses | `web/lib/jev/questions.ts` |
| Parallel decisions | Jev | Five analysts, same state, isolated runs; strict schema validation | `web/lib/jev/parallel.ts`, `web/lib/ai` |
| Choice · Score · Probability | Jev | Closed fork enum; score computed from 0–4 ratings (never by the model); probability 1–99 % | `web/lib/jev/score.ts` |
| Batch decisions | DecMarkt | Each agent submits all its answers in one `submitBatch` transaction, bonded | `DecisionRegistry` |
| Aggregation · Threshold | DecMarkt | Probability × on-chain track record per fork; quorum, share and score gates; any failed gate falls back to NO_ACTION | `DecisionEngine`, `web/lib/decmarkt/aggregate.ts` |
| Bounded action | Monad | NO_ACTION / DERISK / DEPLOY move test MON between two vault buckets; ESCALATE goes to a human guardian | `ExecutionVault` |
| Verify | Monad | First signed Pyth price at or after `executedAt + horizon` (`parsePriceFeedUpdatesUnique`) | `OutcomeRegistry` |
| Settlement | DecMarkt | Correct agents share the round reward pro rata to probability; incorrect agents are slashed; missed submissions are penalised | `OutcomeRegistry` |

The app recomputes every aggregation, outcome and settlement from on-chain inputs and compares the result
with what the contracts recorded (`web/lib/decmarkt/reproduce.ts`).

## Deployment (Monad Testnet)

| Contract | Address |
|---|---|
| DecisionRegistry | [`0x86d7E507F9eBfda17c5265804996b71028b05D10`](https://testnet.monadexplorer.com/address/0x86d7E507F9eBfda17c5265804996b71028b05D10) |
| DecisionEngine | [`0x2F4773B8d8cF125Fc0fCbd1973834065f3CA40b3`](https://testnet.monadexplorer.com/address/0x2F4773B8d8cF125Fc0fCbd1973834065f3CA40b3) |
| ExecutionVault | [`0x65355f7f037b84E14Bc2147700Bb6b3F29B56276`](https://testnet.monadexplorer.com/address/0x65355f7f037b84E14Bc2147700Bb6b3F29B56276) |
| OutcomeRegistry | [`0x97ec926D45115caB5D56aF2A8d373c78D80cFa47`](https://testnet.monadexplorer.com/address/0x97ec926D45115caB5D56aF2A8d373c78D80cFa47) |

Source is verified on Sourcify (exact match). The oracle is the Pyth contract `0x2880aB15…8C17B43`, with the ETH/USD feed as the
reference market. Details: [contracts/DEPLOYMENTS.md](contracts/DEPLOYMENTS.md).

## Run it

```bash
cd contracts && forge test                 # contract tests
cd web && cp .env.example .env.local       # fill in keys (see comments)
cd web && npm install && npm run dev       # http://localhost:3000
cd web && npm run check                    # typecheck, lint, unit tests, production build
cd web && bash scripts/integration.sh      # full round on a local anvil chain
```

The `/demo` page runs one round in two modes:
- **Simulation:** real state and real agents; nothing goes on chain.
- **Live testnet:** every stage is a Monad transaction. It requires signing in with a wallet that holds the admin or guardian role.

## Documentation

- [ARCHITECTURE](ARCHITECTURE.md)
- [JEV_INTEGRATION](JEV_INTEGRATION.md)
- [DATA_MODEL](DATA_MODEL.md)
- [CONTRACT_SPEC](CONTRACT_SPEC.md)
- [SECURITY_MODEL](SECURITY_MODEL.md)
- [SECURITY_AUDIT](SECURITY_AUDIT.md)
- [DEMO_FLOW](DEMO_FLOW.md)
- [DEPLOYMENT](DEPLOYMENT.md)
- [FINAL_CHECKLIST](FINAL_CHECKLIST.md)

## Scope and limitations

This is a testnet prototype. The vault holds test MON only. The five agent keys are held by one server,
acting as a relay. The security review is an internal one, not an external audit. The limitations are
listed in [FINAL_CHECKLIST.md](FINAL_CHECKLIST.md#known-limitations).
