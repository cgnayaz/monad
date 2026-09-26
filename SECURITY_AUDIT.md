# DecMarkt — Security Audit

Date: 2026-09-26 · Scope: `contracts/src`, `contracts/script`, `web/lib/{jev,ai,engine,chain,collectors,store,server,data}`,
`web/app/api`, `web/components/wallet`, `web/next.config.ts`, environment files, build output, git history.
Method: manual review of every trust boundary (browser → API → server keys → contracts → Pyth), with
the assumption that nothing is secure until shown by a test. Every fix below has a test or an
on-chain check; nothing was marked fixed without one.

## Summary

| ID | Severity | Title | Status |
|---|---|---|---|
| H-1 | High | Resolver can cherry-pick the resolution price inside the tolerance window | Fixed, redeployed |
| H-2 | High | Unauthenticated API can spend server keys, agent bonds and AI credits | Fixed |
| M-1 | Medium | Executor chooses the start price from a 60 s window | Fixed, redeployed |
| M-2 | Medium | Void grace (300 s) lets anyone void an outcome during a short oracle/RPC outage | Fixed, redeployed |
| M-3 | Medium | Payload keys collide across deployments (decision ids restart at 1) | Fixed |
| M-4 | Medium | Public oracle/read routes can exhaust Hermes and RPC quota | Fixed |
| M-5 | Medium | Unbounded request bodies | Fixed |
| M-6 | Medium | No security headers (clickjacking of wallet actions, no CSP) | Fixed |
| L-1 | Low | `lockPerAgent` has no upper bound | Fixed, redeployed |
| L-2 | Low | Reward pool funds cannot be recovered | Fixed, redeployed |
| L-3 | Low | Session role is not re-checked on chain after sign-in | Accepted |
| L-4 | Low | Rate limits are per instance and keyed on `x-forwarded-for` | Accepted |
| L-5 | Low | Pyth API key was shared in a chat message | Action for owner |
| I-1…I-9 | Info | Trust assumptions and verified non-issues | Documented |

No critical issues were found. All high and medium issues are fixed; the contracts were redeployed
with the fixes (addresses in [contracts/DEPLOYMENTS.md](contracts/DEPLOYMENTS.md)) and the old
deployment was paused and drained.

---

## High

### H-1 · Resolver can cherry-pick the resolution price

- **Location:** `contracts/src/OutcomeRegistry.sol` `resolve` (previously `pyth.parsePriceFeedUpdates(update, ids, t0, t0 + 60)`).
- **Problem:** `parsePriceFeedUpdates` accepts *any* signed update whose publish time falls in
  `[t0, t0 + 60]`. Pyth publishes roughly every 400 ms, so a resolver could choose among ~150 valid
  prices and submit the one that makes the outcome it prefers.
- **Impact:** The outcome decides which agents are rewarded and which are slashed. An agent
  operator (or anyone paid by one) could flip `success` and the settlement whenever the move is
  near the band, turning the accountability layer into a race to resolve.
- **Fix:** `resolve` now calls `parsePriceFeedUpdatesUnique(update, ids, t0, t0 + 60)` through
  `contracts/src/interfaces/IPythUnique.sol`. Pyth accepts only an update whose
  `prevPublishTime < t0 ≤ publishTime`, i.e. the **first** price at or after `t0`. There is exactly one
  valid resolution price. The server (`web/lib/chain/execution-layer.ts`) and the browser
  (`web/components/wallet/lifecycle-actions.tsx`) fetch that update with `priceUpdateAt(t0)`.
- **Verification:**
  - `forge test --match-test test_CannotCherryPickResolutionPrice` — a later update inside the window reverts; the first one succeeds.
  - `test_PriceOutsideWindow`, `test_RecordsOutcome`, `test_VoidAfterGrace` (mock `MockPythUnique` enforces the same rule as Pyth).
  - Real Pyth: `web/scripts/fork-pyth.sh` runs `test_RealPythLifecycleAndNoCherryPicking` against the deployed
    contracts and the live Pyth contract `0x2880…7B43` with signed Hermes updates: execute → resolve with the first update succeeds,
    a later update in the window reverts. Result: PASS.

### H-2 · Unauthenticated API spends server keys, bonds and AI credits

- **Location:** `web/app/api/decisions/route.ts` (live mode), `web/app/api/decisions/[id]/advance/route.ts`.
- **Problem:** Anyone who could reach the site could start live rounds and keeper steps. Each
  live round signs transactions with the proposer and five agent keys, locks agent bonds and
  calls the AI provider; each advance spends keeper gas and Pyth fees.
- **Impact:** Draining of operator gas balances, bonds locked in rounds nobody watches (and
  slashed on missed submissions), exhausted AI credits, and denial of service for the demo.
- **Fix:** Operator sessions (`web/lib/server/operator-session.ts`, `web/app/api/operator/*`):
  1. `GET /api/operator/challenge` returns a stateless challenge (HMAC over issue time + random, bound to chain id and registry address, 5 min TTL).
  2. The wallet signs it (`personal_sign`, no transaction).
  3. `POST /api/operator/session` recovers the signer and reads on chain whether it holds `DEFAULT_ADMIN_ROLE` on DecisionRegistry or `GUARDIAN_ROLE` on DecisionEngine. Each challenge is accepted once.
  4. The server sets `dm_operator`: `address|role|exp|hmac`, httpOnly, `SameSite=Strict`, `Secure` in production, 30 min.

  Live rounds and `/advance` return 401 without a valid session; simulation rounds (AI cost only)
  are rate limited to 3 per 10 min per client. Live mode is reported as not ready without
  `SESSION_SECRET` (`web/lib/data/readiness.ts`). The demo UI shows the operator sign-in bar and
  disables live start without it (`web/components/wallet/operator-session.tsx`).
- **Verification:** `web/lib/server/operator-session.test.ts`: role holder accepted; replay, non-role wallet, forged nonce,
  expired challenge, tampered role/address cookie, expired cookie and weak secret all rejected.
  Manual: `curl -X POST /api/decisions -d '{"mode":"live"}'` → 401; `/advance` → 401.

## Medium

### M-1 · Executor chooses the start price

- **Location:** `contracts/src/ExecutionVault.sol` `execute`.
- **Problem:** The start price was accepted from `[now − 60, now]`, which let the executor choose among many prices.
- **Impact:** The start price is half of the outcome measurement, with the same effect as H-1 at smaller scale.
- **Fix:** `MAX_PRICE_AGE = 10` s. The executor can still choose *when* to execute (I-7), but not an old price.
- **Verification:** `test_StalePriceRejected` (11 s old update reverts), fork test executes with a fresh Hermes update.

### M-2 · Short void grace

- **Location:** `contracts/src/OutcomeRegistry.sol` `voidOutcome`.
- **Problem:** Anyone could void an outcome 300 s after the window closed. An oracle or RPC hiccup of a few minutes was enough to void it.
- **Impact:** A void returns every lock with no reward or penalty. An agent that expects to be slashed can wait for any outage and void the round.
- **Fix:** `VOID_GRACE = 1 hours`. Void stays the liveness escape hatch.
- **Verification:** `test_VoidAfterGrace` (reverts before `t0 + 60 + 3600`, succeeds after).

### M-3 · Payload key collision across deployments

- **Location:** `web/lib/store/payload-store.ts`.
- **Problem:** Agent runs were stored at `runs/{decisionId}/{agentId}.json`. After a redeploy, decision 1 of the new registry read decision 1 of the old one.
- **Impact:** Wrong reasons shown. The hash check rejects them, but a valid record then showed as "mismatch".
- **Fix:** Keys are `runs/{registryAddress}/{decisionId}/{agentId}.json`. States and questions are content-addressed and unaffected.
- **Verification:** `npm run check` (pipeline tests write and read through the store); integration test reads back runs on a fresh anvil deployment.

### M-4 · Quota exhaustion through public routes

- **Location:** `web/app/api/oracle/{price,update}`, `web/app/api/decisions/[id]`.
- **Problem:** Unauthenticated routes proxied the keyed Hermes API and the RPC without limits.
- **Impact:** A loop could burn the Pyth key's quota, and live execution and resolution would then fail.
- **Fix:** `web/lib/server/rate-limit.ts`, with these limits per client:

  | Route | Limit |
  |---|---|
  | oracle price | 30/min |
  | oracle update | 20/min |
  | decision read | 60/min |
  | challenge / session | 10/min |
  | simulation | 3/10 min |

  The `at` query is validated as a unix timestamp.
- **Verification:** Code review and a manual burst with `curl` returning 429 with `Retry-After`. See L-4 for limits.

### M-5 · Unbounded request bodies

- **Location:** `POST /api/decisions`, `POST /api/operator/session`.
- **Problem:** The bodies were parsed without a size limit.
- **Impact:** Memory pressure and denial of service.
- **Fix:** `readJsonBody(req, max)` (256 bytes and 2 KB), plus `.strict()` zod schemas. Decision ids must match `^[1-9]\d{0,30}$`.
- **Verification:** Typecheck plus code review. Oversized body → 413.

### M-6 · Missing security headers

- **Location:** `web/next.config.ts`.
- **Problem:** The app could be framed. A framed page can trick a connected wallet user into clicking a lifecycle action (clickjacking), and there was no CSP.
- **Fix:**
  - `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  - CSP `default-src 'self'`; `connect-src` limited to self and the Monad RPC; no third-party scripts.
  - `'unsafe-inline'` scripts remain because Next.js inlines its bootstrap.
- **Verification:** `npm run build`; response headers checked on a running server.

## Low

### L-1 · No cap on `lockPerAgent`
- **Location:** `DecisionRegistry._validateConfig`.
- **Problem / impact:** A misconfigured or compromised proposer could lock whole bonds in one round and expose them to slashing.
- **Fix:** `MAX_LOCK_PER_AGENT = 1 ether`.
- **Verification:** `test_InvalidConfig` (lock above the cap reverts).

### L-2 · Reward pool unrecoverable
- **Location:** `DecisionRegistry`.
- **Problem / impact:** Funds in the reward pool had no exit path. 0.5 MON is permanently stuck in the retired registry `0x5Bb0…7894`.
- **Fix:** `withdrawRewardPool(to, amount)`, callable by the admin only, while paused, and nonReentrant. Same pattern as the vault's `emergencyWithdraw`.
- **Verification:** `test_RewardPoolWithdrawalOnlyAdminWhilePaused`.

### L-3 · Session role not re-checked
- **Location:** `operatorFromCookie`.
- **Problem:** A wallet whose role is revoked keeps its session for up to 30 minutes.
- **Accepted:** The session only unlocks actions that the contracts would allow the server keys to perform anyway. Rotate `SESSION_SECRET` to revoke all sessions immediately.

### L-4 · Rate limits are best effort
- **Location:** `web/lib/server/rate-limit.ts`.
- **Problem:** Counters are in memory and per instance. The key is the first `x-forwarded-for` hop, which is trustworthy on Vercel (the proxy sets it) but spoofable when the app is exposed directly.
- **Accepted for the demo:** Spending endpoints are protected by H-2, not by rate limits. For production, use a shared store (Upstash/Redis) and the platform's client IP.

### L-5 · Pyth API key shared in chat
- **Location:** Hermes key used as `PYTH_API_KEY`.
- **Problem:** The key was pasted into a chat message. It is stored only in `web/.env.local` (gitignored, mode 600). It appears in no committed file, no build output and nowhere in git history (checked, see below).
- **Action:** Rotate the key in the Pyth dashboard after the hackathon and update `.env.local` / the Vercel environment.
- **Entitlement:** The key covers ETH/USD but not MON/USD (Hermes returns 403 "Not entitled"). For that reason the reference feed is ETH/USD (`web/lib/config/public.ts` `PYTH`, `Deploy.s.sol` `REFERENCE_FEED`).

## Informational — trust assumptions and verified non-issues

| ID | Item | Assessment |
|---|---|---|
| I-1 | Agents can read other agents' submissions on chain before submitting | Copying is possible within the window. Mitigations: all five run in parallel from the same state, and payoffs are probability-weighted. Commit–reveal is the documented extension (SECURITY_MODEL.md). |
| I-2 | The server holds all five agent keys and the proposer key | Trusted relay for the demo. Each agent has its own address and bond; keys never reach the browser or the model. Separate operators would run their own relays. |
| I-3 | The proposer chooses the state snapshot | The state hash is committed on chain before agents run. Payloads are recomputed and compared on read (`web/lib/decmarkt/reproduce.ts`), so tampering after the fact is detectable. |
| I-4 | Proposer can cancel before aggregation; admin can `emergencyWithdraw` while paused | Intended powers, role-gated and visible on chain. They cannot move funds to an arbitrary address outside a pause. |
| I-5 | AI layer | Inputs are numeric and sourced; output is a strict zod schema (closed choice enum, integer ranges, reason length). The model never sees keys and never produces addresses, amounts or calldata. Invalid output is recorded as `invalid_json` / `schema_violation` and settled as missed. Prompt injection has no data path: no free-text external input reaches the prompt. |
| I-6 | Wallet actions | `web/lib/chain/wallet-actions.ts` exposes five fixed functions whose only argument is a decision id (plus a bounded guardian choice). Each call is simulated before the wallet opens, and only a receipt with `status: success` counts. No `tx.origin` anywhere (`grep`). |
| I-7 | Executor timing | Anyone may execute once APPROVED and chooses the moment (within 10 s price freshness). Accepted: the horizon starts at execution, so timing does not choose the end price (H-1). |
| I-8 | Liveness | Every step after submission is permissionless (aggregate, finalize escalation, execute, resolve, void), so no single key can stall a round. |
| I-9 | Frontend | No `dangerouslySetInnerHTML`, `eval` or `new Function` in app code; React escapes all rendered data; external links use `rel="noreferrer"`. |

## Secrets and build output

- **Environment files:**
  - The only public variable is `NEXT_PUBLIC_MONAD_RPC_URL`.
  - Private keys, `PYTH_API_KEY`, `ANTHROPIC_API_KEY`, `SESSION_SECRET` and `BLOB_READ_WRITE_TOKEN` are read only in `server-only` modules.
  - `.env`, `.env.local`: gitignored; only the `.env.example` files are tracked.
- **Build output:** every secret value in `web/.env.local` and `contracts/.env` was searched for in `.next/static` and `.next/server/app` after `npm run build`. **0 hits.** The client bundle contains only the env var *names* of the agent keys (agent metadata), never values.
- **Git history:** `git log -p --all` searched for Anthropic key patterns, `PRIVATE_KEY=0x…` and the Pyth key. **0 hits.**
- **Test keys:** the private keys in `web/scripts/*.sh` and tests are Anvil's public development keys, used only against a local chain.

## Test results after the fixes

| Suite | Result |
|---|---|
| `forge test` (unit, fuzz) | 68 passed, 0 failed |
| `web/scripts/fork-pyth.sh` (deployed contracts + live Pyth + Hermes) | PASS |
| `cd web && npm run check` (typegen, tsc, eslint, vitest, build) | green; vitest 56 passed |
| `web/scripts/integration.sh` (anvil end-to-end) | 1 passed |

Manual checks against `next start` (production build):

| Request | Result |
|---|---|
| `POST /api/decisions {"mode":"live"}` without session | 401 |
| `POST /api/decisions/1/advance` without session | 401 |
| `/advance` with a forged `dm_operator` cookie | 401 |
| `POST /api/decisions` with a 500-byte body | 413 |
| `POST /api/decisions` with an extra field | 400 |
| 32 × `GET /api/oracle/price` | 30 × 200, then 429 |
| `GET /` headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP present |

## Redeployment

The contract fixes (H-1, M-1, M-2, L-1, L-2) required a new deployment. The new contracts are verified on Sourcify (exact match). The operator wallet `0xbAB6…0B97` holds `DEFAULT_ADMIN_ROLE` and `GUARDIAN_ROLE`.

The old deployment was retired as follows:
- all four contracts paused;
- treasury withdrawn;
- agent bonds withdrawn.

See [contracts/DEPLOYMENTS.md](contracts/DEPLOYMENTS.md).
