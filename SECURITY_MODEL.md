# Security Model

## 1. Principles

1. **AI proposes, rules decide.** Model output can only select values from closed sets and
   bounded ranges. Aggregation, approval, outcome and settlement are deterministic code.
2. **AI never touches keys or calldata.** Keys live in server env; the ABI and target of
   every transaction are fixed in code.
3. **Fail safe.** Every failure path ends in `NO_ACTION` or `CANCELLED`, never in an action.
4. **Verify, don't trust payloads.** Off-chain data is displayed only with its hash status.

## 2. Assets

| Asset | Where | Worst case if lost |
|---|---|---|
| Treasury test MON | `ExecutionVault` | bounded per action by `actionBps`, `maxMove`, cooldown; no outbound path except paused admin withdrawal |
| Agent bonds, reward pool | `DecisionRegistry` | slashing bounded by `slashBps` cap |
| Server keys (proposer, 5 agents, keeper) | Vercel env | attacker could submit/propose within bounds; cannot move treasury out |
| AI API key | Vercel env | cost abuse; rate-limited |
| Admin key | deployer wallet (testnet only) | parameter changes within hard caps |

All keys are **testnet-only** and hold small balances.

## 3. Threats and mitigations

| Threat | Mitigation |
|---|---|
| Prompt injection via state content | State contains numbers and fixed labels from our collectors only; no free text from users. Output is schema-validated; even a fully hijacked model can only pick one of 4 forks with probability ≤ 9900 |
| Model invents an action / calldata | Closed enum mapping; contract has no generic call path |
| Model output malformed | Zod `strict()` + assignment/rubric/evidence checks → run invalid → MISSED |
| Agent copies another agent | Isolated calls, no shared context. (Commit–reveal is a listed extension for untrusted third-party agents) |
| Agent self-settlement | Settlement computed by `OutcomeRegistry` from oracle data; agents have no role in it |
| Proposer rewrites state after the fact | `stateHash` committed before agents run; duplicate `stateHash` rejected |
| Outcome manipulation | Pyth signature verification + strict publish-time window; resolver cannot choose a favorable price outside the window |
| Oracle unavailable | `voidOutcome` after grace: all bonds returned, no settlement |
| Replay of submissions | one submission per (decisionId, agentId); decision ids are monotonic per registry; chain id bound by deployment |
| Late submissions | `DeadlinePassed` |
| Reentrancy | `nonReentrant` on `withdrawBond`, `execute`, `resolve`; checks-effects-interactions; pull payments |
| Unauthorized status change | role-gated `setStatus` + explicit transition table |
| Parameter abuse by admin | hard caps in code (§8 of CONTRACT_SPEC.md); all changes emit events |
| Emergency | `Pausable` on engine, vault, outcome |
| Demo endpoint abuse | server-side rate limit per IP + global concurrency of 1 active round; operation requires no user secrets |
| Secret leakage to client | only `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, contract addresses are public; CI grep check for `NEXT_PUBLIC_.*KEY` |
| Tx.origin phishing | `tx.origin` never used |

## 4. Trust assumptions (explicit)

1. **Server relays model output faithfully.** The five operator keys are held by the
   DecMarkt server, so the system cannot cryptographically prove the submitted choice
   equals the model's raw output. We publish the raw output hash, full answers, model id
   and latency per run, and bind them with `reasonHash`/`answersRoot`. For untrusted,
   independently operated agents, each agent runs its own operator key — the contract
   already supports this without change.
2. **Proposer selects the state honestly.** Tamper-evident, not selection-proof.
3. **Pyth** is the price authority.
4. **Guardian** acts only when agents vote ESCALATE, and only among bounded forks.

## 5. Key management

- Keys are generated fresh for the hackathon (`cast wallet new`), never reused, never
  printed in logs, stored only in `contracts/.env`, `web/.env.local` and Vercel env.
- `.gitignore` covers `.env`, `.env.*` (except `.env.example`).
- Pre-commit / pre-deploy check: `git ls-files | xargs grep -nE '0x[0-9a-fA-F]{64}'` must
  only match public hashes (reviewed), and `gitleaks`-style grep for `sk-ant-`.
- Each agent key holds only gas + bond; the proposer key holds gas only.

## 6. Server input validation

- All API route bodies validated with Zod; round endpoints take only a `decisionId`.
- The server never accepts a fork, amount, address or calldata from the browser.
- Guardian decisions are signed by the guardian's own wallet in the browser, not by the server.

## 7. Review gates

- Security review by the repo agent `guvenlik-denetcisi` before first testnet deploy and before submission.
- `forge test` + fuzz green, `forge coverage` reported.
- Manual check of each item in §3 against the code, recorded in this file.
