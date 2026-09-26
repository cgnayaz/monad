# DecMarkt — Final checklist

Date: 2026-09-26. Every item marked ✅ was verified by running it; the command or the on-chain
reference is next to it. Items not verified are marked ⚠️ with the reason. Nothing here is estimated.

## Architecture

| Item | Status | Evidence |
|---|---|---|
| Three layers: Jev structures → DecMarkt makes accountable → Monad executes and records | ✅ | [ARCHITECTURE.md](ARCHITECTURE.md); `/how-it-works` names the layer and code location of each stage |
| AI never signs, never produces calldata, addresses or amounts | ✅ | Model output is a strict schema (`web/lib/validation/model-output.ts`); keys live only in `server-only` modules; wallet actions take a decision id only (`web/lib/chain/wallet-actions.ts`) |
| Only bounded forks can execute | ✅ | Closed enum + per-decision mask, checked in server and contract (`test_InvalidChoice`, `test_ChoiceOutsideAllowedForks`) |

## Jev integration (each concept is a real data structure, not a label)

| Concept | Status | Evidence in the live round (decision #1) and code |
|---|---|---|
| State | ✅ | 14 sourced inputs, canonical JSON, hash `0xba0096…fd24` committed by `createDecision` |
| Questions | ✅ | 6 questions with ids and input lists; set hash `0x516ddd…6668` committed |
| Parallel decisions | ✅ | 5 isolated provider calls on the same state; per-agent latency shown |
| Choice · Score · Probability | ✅ | e.g. Risk Analyst NO_ACTION · 7917 · 85 %; score computed from rubric ratings (`web/lib/jev/score.ts`) |
| Batch decisions | ✅ | One `submitBatch` per agent with 2 answers (action + domain question) |
| Bounded forks | ✅ | NO_ACTION / DERISK / DEPLOY / ESCALATE, fork table on `/demo` |
| Action | ✅ | Engine approved NO_ACTION; `ExecutionVault.execute` tx `0x42a6…1ef1` |
| Verify | ✅ | `OutcomeRegistry.resolve` tx `0xf936…6380`, move +2 bps vs band ±10 → success |

## DecMarkt accountability

| Item | Status | Evidence |
|---|---|---|
| Agent identity | ✅ | 5 registered agents, each with its own operator address (`/agents`) |
| Economic bond | ✅ | 0.5 MON bond per agent; 0.05 MON locked per round |
| Aggregation + threshold | ✅ | On-chain `getAggregation`; UI recomputes and matches; quorum/share/score gates |
| Execution | ✅ | Vault state before/after read from chain |
| Outcome | ✅ | Recorded outcome recomputed from the Pyth prices: "matches the recorded outcome" |
| Reward | ✅ | Live round: all 5 correct, 0.02 MON pool split by probability (e.g. 0.0044 MON for p = 92 %) |
| Penalty | ✅ (tests) | Not exercised live because all agents were correct in the live round; covered by `test_SuccessFalse_WhenFailSafeMeetsMove`, `test_MissedFinalSubmissionIsPenalised`, `testFuzz_SettlementConservesValue` |

## Contracts

| Item | Status | Evidence |
|---|---|---|
| Unit + fuzz tests | ✅ | `forge test` → 68 passed, 0 failed |
| Fork test against the live deployment and the real Pyth contract | ✅ | `web/scripts/fork-pyth.sh` → PASS (run 2026-09-26) |
| Source verification | ✅ | Sourcify exact match, all four contracts |
| Security review | ✅ | [SECURITY_AUDIT.md](SECURITY_AUDIT.md): 2 high, 6 medium, 2 low fixed; internal review, not an external audit |

## Frontend

| Item | Status | Evidence |
|---|---|---|
| Typecheck, lint, unit tests, production build | ✅ | `npm run check` → tsc clean, eslint clean, 65 tests passed, build compiled |
| Pages render real data only | ✅ | Checked in the production build: `/`, `/demo`, `/decisions`, `/decisions/1`, `/agents`, `/contracts`, `/how-it-works`; an unknown decision returns 404 |
| No secrets in client bundle | ✅ | Every secret value searched in `.next/` output → 0 hits |
| Error handling | ✅ | `app/error.tsx`, `app/global-error.tsx`; API errors sanitised (`publicError`, unit-tested) |

## AI

| Item | Status | Evidence |
|---|---|---|
| Provider | ✅ | Gemini via `@google/genai`; `gemini-3.8-flash`, fallback `gemini-3.7-flash`, `gemini-3.6-flash` on 5xx/429 |
| Live call works | ✅ | Simulation round: 5/5 valid decisions in 3.3–7.3 s; live round: 5/5 valid |
| Server-side only | ✅ | Provider code is `server-only`; key never sent to the browser |
| Claude provider | ⚠️ | Code path present (`AI_PROVIDER=anthropic`); the configured Anthropic account had no credit, so it was not exercised end to end |

## Security

| Item | Status | Evidence |
|---|---|---|
| Live rounds / keeper steps need an operator session | ✅ | Unauthenticated → 401 (curl), unit tests in `operator-session.test.ts` |
| Rate limits, body limits, security headers | ✅ | 429 after 30 oracle requests/min, 413 on oversized body, CSP/X-Frame-Options present |
| Resolution price cannot be chosen | ✅ | `test_CannotCherryPickResolutionPrice` + live fork test; live round's end price published exactly at t0 |
| Keys pasted into chat | ⚠️ | Pyth, Anthropic and Gemini keys were shared in chat; rotate them after the event |

## Monad

| Item | Status | Evidence |
|---|---|---|
| Chain id / RPC / explorer | ✅ | `eth_chainId` = 10143 on `https://testnet-rpc.monad.xyz`; explorer links to `testnet.monadexplorer.com` |
| Contract addresses | ✅ | Bytecode present at all four addresses; oracle feed id ETH/USD in vault and outcome registry |
| Full live round | ✅ | Decision #1: `createDecision` `0x659ef618…f733` (block 65848480), `openDecision` `0xd9ebbbbf…c836`, 5 × `submitBatch`, `aggregate` `0x87f0bd…f2e4`, `execute` `0x42a6076d…1ef1` (block 65848630), `resolve` `0xf936bc19…6380` (block 65848849); every receipt `status = success` |
| Reads batched | ✅ | Multicall3 on Monad Testnet (disabled for local anvil) |

## Deployment

| Item | Status | Evidence |
|---|---|---|
| Vercel project | ✅ | https://decmarkt.vercel.app — built from `main`, root `web`; serves chain data (decision #1), live endpoint returns 401 without a session, CSP / X-Frame-Options headers present |
| Secrets on Vercel | ⚠️ | Must be entered by the owner in Vercel → Settings → Environment Variables (list in [DEPLOYMENT.md](DEPLOYMENT.md#4-web-vercel)) |
| Payload store | ⚠️ | Needs a Vercel Blob store connected (`BLOB_READ_WRITE_TOKEN`); without it agent reasons are not shown on decision pages (hashes still are) |

## Demo

| Step | Simulation | Live |
|---|---|---|
| State | ✅ 14/14 inputs | ✅ |
| Questions | ✅ 6 | ✅ |
| Agents | ✅ 5/5 | ✅ 5/5 |
| Decision primitives | ✅ | ✅ |
| Aggregation · threshold | ✅ 100 % ≥ 60 % | ✅ 100 % ≥ 60 % |
| Action | ✅ NO_ACTION | ✅ NO_ACTION |
| Monad transaction | skipped by design | ✅ |
| Verification | ✅ observed from Pyth | ✅ on-chain `resolve` |
| Settlement | ✅ notional | ✅ on-chain |

## Known limitations

- **Testnet only.** The vault holds test MON. The admin can pause the contracts and withdraw funds while they are paused.
- **Trusted relay.** One server holds all five agent keys, the proposer key and the keeper key. The agents are separate identities with separate bonds, not separate operators.
- **Agents can copy.** Submissions are public before the deadline, so an agent can copy another's answer. Commit–reveal is a documented extension and is not implemented.
- **Proposer picks the state snapshot.** It is hashed and committed before any agent runs, but the proposer is trusted to collect it honestly.
- **Rate limits are per instance and in memory.** They are not shared across Vercel instances.
- **One running round per instance.**
- **Short time scale.** Rounds use a 90 s submission window and a 60 s horizon. With a ±10 bps band over 60 s, most rounds resolve to NO_ACTION.
- **Early aggregation.** Aggregation happens immediately once all agents have submitted, so the submission window is often not used in full.
- **Free-tier model quota.** The Gemini key is on a free tier. The Pro models return 429, so the agents use Flash models, and overload (503) is handled with fallbacks.
- **No performance claims.** No claim is made about decision quality, accuracy or any improvement from Jev. Accuracy is recorded on chain per agent, and there are very few resolved rounds so far.
- **Internal security review.** The review in SECURITY_AUDIT.md was internal; there has been no external audit.
