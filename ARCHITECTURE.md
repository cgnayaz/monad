# DecMarkt — Architecture

> **AI decisions with on-chain accountability.**

DecMarkt is a decision accountability system. Five independent AI analysts evaluate a
structured, hashed state; their decisions are submitted on-chain against economic bonds;
a deterministic on-chain engine aggregates them and authorizes one of a fixed set of
bounded actions; the real-world outcome is verified from a cryptographically signed
oracle price; and agents are rewarded or penalized by deterministic rules.

```
Jev structures decisions.
DecMarkt makes decisions accountable.
Monad makes the result enforceable and auditable.
```

Companion documents:
[JEV_INTEGRATION.md](JEV_INTEGRATION.md) · [DATA_MODEL.md](DATA_MODEL.md) ·
[CONTRACT_SPEC.md](CONTRACT_SPEC.md) · [SECURITY_MODEL.md](SECURITY_MODEL.md) ·
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) · [DEMO_FLOW.md](DEMO_FLOW.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 1. The decision being made

A concrete, verifiable decision domain is required so that "outcome" and "correct" are
not opinions. DecMarkt v1 governs the **risk posture of an on-chain treasury vault**:

| | |
|---|---|
| Asset | Test MON held by `ExecutionVault` on Monad Testnet |
| Reference market | Pyth `MON/USD` price feed (verified live on Monad Testnet, see §6) |
| Decision | Over the next horizon `H`, should the vault move part of its funds between its `ACTIVE` and `RESERVE` buckets? |
| Bounded forks | `NO_ACTION`, `DERISK` (ACTION_A), `DEPLOY` (ACTION_B), `ESCALATE` |
| Real outcome | Signed Pyth MON/USD price at execution vs. at `executedAt + H` |
| Correct fork | Price fell more than band `b` → `DERISK`; rose more than `b` → `DEPLOY`; otherwise `NO_ACTION` |

The bucket move is real on-chain state (real MON, real balances), deliberately
**without any external call**. DecMarkt does not claim yield; the value of the product is
the accountable decision pipeline, not a trading strategy. The design keeps the action
set pluggable, so other bounded actions can be added later behind the same guarantees.

## 2. Three layers

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — JEV DECISION LAYER                       (server, web/lib/jev)      │
│                                                                              │
│  REAL STATE ─► JEV STATE ─► JEV QUESTIONS ─► PARALLEL DECISIONS (5 agents)   │
│  Pyth, Monad RPC,  canonical JSON,  explicit,       each: CHOICE · SCORE ·    │
│  vault, registry   versioned,       typed,          PROBABILITY · REASON      │
│                    keccak256 hash   hashed          (batch of answers)        │
├──────────────────────────────────────────────────────────────────────────────┤
│ LAYER 2 — DECMARKT ACCOUNTABILITY LAYER   (contracts + web/lib/decmarkt)      │
│                                                                              │
│  agent identity · bonds · submission · DECISION ENGINE (aggregation)         │
│  · THRESHOLD · execution authorization · outcome · reward / penalty          │
├──────────────────────────────────────────────────────────────────────────────┤
│ LAYER 3 — MONAD EXECUTION & SETTLEMENT LAYER          (contracts/src)         │
│                                                                              │
│  DecisionRegistry ─► DecisionEngine ─► ExecutionVault ─► OutcomeRegistry     │
│  lifecycle, agents,  aggregate +       BOUNDED ACTION    VERIFY (Pyth) +      │
│  bonds, submissions  threshold         (no ext. calls)   SETTLEMENT           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Full pipeline, with the component responsible for each step:

| Step | Component | Where |
|---|---|---|
| REAL STATE | `StateCollector` reads Pyth Hermes, Monad RPC, vault and registry views | server |
| JEV STATE | `buildState()` → canonical JSON (RFC 8785) → `stateHash = keccak256` | server |
| JEV QUESTIONS | `buildQuestionSet()` → explicit typed questions → `questionsHash` | server |
| commit | `DecisionRegistry.createDecision(stateHash, questionsHash, config)` | Monad |
| PARALLEL DECISIONS | 5 isolated `DecisionProvider.evaluate()` calls, `Promise.allSettled` | server |
| CHOICE/SCORE/PROBABILITY | model output validated by Zod; score computed deterministically from rubric | server |
| BATCH | all answers → Merkle tree → `answersRoot` | server |
| submission | each agent's operator key calls `DecisionRegistry.submit(...)` | Monad |
| DECISION ENGINE + THRESHOLD | `DecisionEngine.aggregate(id)` — pure integer math on-chain | Monad |
| BOUNDED ACTION | `ExecutionVault.execute(id, pythUpdate)` — only the approved fork | Monad |
| REAL OUTCOME + VERIFY | `OutcomeRegistry.resolve(id, pythUpdate)` — Pyth signature + publish-time window | Monad |
| REWARD / PENALTY | `OutcomeRegistry` computes deltas; `DecisionRegistry` moves bond balances | Monad |
| audit | UI recomputes hashes of off-chain payloads and compares to on-chain values | browser |

## 3. Responsibility split

**Jev (decision structure) — never touches keys or funds.**
Defines what is known (State), what is asked (Questions), what may be chosen (Bounded
Forks), and the shape of every decision (Choice, Score, Probability, Reason). Runs the
agents in parallel and preserves per-answer provenance (Batch).

**DecMarkt (accountability) — defines who is responsible and what it costs.**
Agent identity, bonds, deterministic aggregation, threshold, authorization, deterministic
settlement. The AI never decides the protocol outcome; the engine and the oracle do.

**Monad (enforcement) — makes it binding and public.**
State transitions, bond escrow, action execution and settlement happen in contracts. Every
number the UI shows about a decision's lifecycle comes from contract storage or logs.

## 4. Repository layout (target)

```
monad-hackathon/
├─ contracts/                     Foundry
│  ├─ src/
│  │  ├─ DecisionRegistry.sol     agents, bonds, lifecycle, submissions
│  │  ├─ DecisionEngine.sol       aggregation, threshold, approval, guardian
│  │  ├─ ExecutionVault.sol       treasury buckets, bounded actions
│  │  ├─ OutcomeRegistry.sol      Pyth verification, outcome, settlement
│  │  ├─ lib/DecTypes.sol         shared enums, structs, errors
│  │  └─ interfaces/
│  ├─ test/                       unit + lifecycle + fuzz tests
│  └─ script/Deploy.s.sol         deploy + role wiring + address export
├─ web/                           Next.js App Router
│  ├─ app/                        routes (§7)
│  │  └─ api/rounds/…             server orchestration endpoints
│  ├─ lib/
│  │  ├─ jev/                     state, questions, primitives, forks, batch, verify
│  │  ├─ decmarkt/                TS mirrors of aggregation + settlement (preview/tests only)
│  │  ├─ ai/                      DecisionProvider interface + implementations
│  │  ├─ chain/                   viem clients, ABIs, addresses, monad chain def
│  │  └─ store/                   content-addressed payload store (Vercel Blob)
│  └─ components/                 design-system primitives + domain components
└─ *.md                           this documentation set
```

## 5. Runtime topology

```
Browser (judge / user)
  │  reads: viem public client → Monad RPC   (lifecycle, submissions, balances)
  │  reads: payload store (Blob)              (state JSON, reasons) → hash-checked
  │  writes (optional): wallet → guardian decision on ESCALATE
  ▼
Next.js on Vercel (server)
  ├─ /api/rounds/*        idempotent step endpoints; each step reads on-chain status first
  ├─ StateCollector       Pyth Hermes, Monad RPC
  ├─ DecisionProvider     AI model calls (server-side key)
  └─ Signers              PROPOSER key, 5 AGENT operator keys, KEEPER key (server env only)
  ▼
Monad Testnet (chain 10143)
  DecisionRegistry · DecisionEngine · ExecutionVault · OutcomeRegistry · Pyth
```

The orchestration is **resumable**: the source of truth for "what step is next" is the
decision status on-chain, not server memory. Every step endpoint is safe to call twice.
This also keeps each serverless invocation short (Vercel function time limits).

Signing boundary: the AI model returns JSON only. Server code validates it, maps it onto
the bounded enum and fixed-point fields, and *then* the agent's operator key signs a call
to a fixed function with a fixed ABI. The model never sees or selects keys, addresses,
calldata, or functions.

## 6. Verified external facts (checked 2026-09-26)

| Fact | Value | How verified |
|---|---|---|
| Monad Testnet chain id | `10143` (`0x279f`) | `eth_chainId` on `https://testnet-rpc.monad.xyz` |
| Pyth contract on Monad Testnet | `0x2880aB155794e7179c9eE2e38200202908C17B43`, `version() = 1.4.6`, `getValidTimePeriod() = 60` | `cast call` |
| Pyth MON/USD feed id | `0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1` | Hermes `/v2/price_feeds?query=MON` |

Anything not in this table (explorer verification method, faucet limits, RPC log-range
limits) is marked *to verify* in [DEPLOYMENT.md](DEPLOYMENT.md).

## 7. Routes

| Route | Purpose |
|---|---|
| `/` | Dashboard: latest decision at a glance, vault buckets, agent standings, live contract status |
| `/demo` | Judge-facing live round: run a round and watch every stage land on-chain |
| `/decisions` | Decision history (read from `DecisionRegistry`) |
| `/decisions/[id]` | Full audit view: state, questions, answers matrix, aggregation, action, outcome, settlement, all tx hashes, hash verification |
| `/agents` | Per-agent identity, operator address, bond, accuracy, settlement history |
| `/contracts` | Deployed addresses, roles, parameters, explorer links, ABI download |
| `/docs` | Technical documentation (renders this doc set) |
| `/how-it-works` | Protocol explanation for first-time visitors |

## 8. Modes and data integrity

- **LIVE TESTNET** — the only mode that writes. Real transactions, real hashes.
- **Read-only history** — past decisions are always shown from chain + verified payloads.
- There is **no simulated mode that produces hashes, blocks, balances or outcomes.**
  If the AI key, RPC or oracle is unavailable, the UI says *unavailable* and why.
- A payload whose recomputed hash does not match the on-chain hash is shown as
  **MISMATCH**, never silently displayed as valid.

## 9. Known limitations (stated, not hidden)

- The five agents' operator keys are held by the DecMarkt server. The system proves what
  was submitted and settles it; it does not prove the server relayed the model output
  faithfully. Mitigation: full model output is published and hashed (`reasonHash`,
  `answersRoot`); see SECURITY_MODEL.md §4.
- The proposer chooses what goes into the state. The state is published and hashed before
  agents run, so it cannot be changed after the fact, but its selection is trusted.
- Demo horizons are short (minutes). Short-horizon price moves are close to noise; the
  demo shows the mechanism, not predictive skill. No accuracy claims are made.
- Pyth prices are trusted as the outcome source (signature-verified on-chain).
