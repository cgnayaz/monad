# Jev Integration

Jev is the **structured decision-generation layer** of DecMarkt. It is not a prompt
template and not a generic LLM orchestrator: every Jev concept is a typed object in code,
has a stable identifier, and is either hashed on-chain or reproducible from on-chain data.

> Scope note: this document defines DecMarkt's concrete implementation of the Jev
> concepts listed in the project brief. No external Jev SDK is used. If a formal Jev
> specification exists, this mapping should be checked against it; nothing here claims
> capabilities or performance for Jev beyond what is implemented.

Code location: `web/lib/jev/` (TypeScript) and the Jev-derived fields in
`contracts/src/lib/DecTypes.sol`.

## Summary mapping

| Jev concept | DecMarkt object | Code | On-chain anchor |
|---|---|---|---|
| State | `JevState` (canonical JSON, versioned) | `jev/state.ts` | `Decision.stateHash` |
| Questions | `JevQuestion[]` in a `QuestionSet` | `jev/questions.ts` | `Decision.questionsHash` |
| Choice | `Fork` enum value | `jev/forks.ts` | `Submission.choice` (uint8) |
| Score | rubric-derived integer, 0–10000 | `jev/score.ts` | `Submission.score` (uint16) |
| Probability | calibrated confidence, 100–9900 bps | `jev/primitives.ts` | `Submission.probability` (uint16) |
| Reason | human-readable text | `jev/primitives.ts` | `Submission.reasonHash` |
| Parallel Decisions | 5 isolated agent runs | `jev/parallel.ts` | 5 independent `submit` txs |
| Batch Decisions | all (agent × question) answers | `jev/batch.ts` | `Submission.answersRoot` (Merkle) |
| Bounded Forks | fixed 4-fork set + per-decision mask | `jev/forks.ts` | `Decision.allowedForks`, `Fork` enum |
| Action | approved fork → vault operation | — | `ExecutionVault.execute` |
| Verify | oracle outcome + integrity checks | `jev/verify.ts` | `OutcomeRegistry.resolve` |

---

## 1. Jev State

The information available to the agents *before* they decide. Nothing else is given to them.

```ts
interface JevState {
  schema: "decmarkt.jev.state/1";      // versioned schema id
  stateId: string;                     // "st_" + first 16 hex of stateHash
  subject: { vault: Address; asset: "MON"; referenceFeed: "MON/USD"; horizonSec: number; bandBps: number };
  observedAt: number;                  // unix seconds, server clock at collection
  inputs: StateInput[];                // only decision-relevant facts
}
interface StateInput {
  key: string;                         // e.g. "market.mon_usd.price"
  value: string | number | null;       // null ⇔ unavailable
  unit?: string;
  source: "pyth-hermes" | "monad-rpc" | "decision-registry" | "execution-vault";
  sourceRef?: string;                  // block number, Pyth publishTime, URL path
  observedAt: number;
  status: "ok" | "unavailable" | "stale";
  note?: string;                       // why unavailable / stale
}
```

Inputs in v1 (all real, fetched at collection time):

| Group | Keys | Source |
|---|---|---|
| Market | `mon_usd.price`, `.conf`, `.publishTime`, `.ema_price` | Pyth Hermes latest |
| History | `mon_usd.change_5m/1h/24h`, realized volatility | Pyth Hermes historical (to verify endpoint limits; marked unavailable if not served) |
| Network | latest block, avg block interval (last N), gas price | Monad RPC |
| Vault | ACTIVE / RESERVE balances, last action, cooldown remaining | `ExecutionVault` views |
| Track record | past decisions' correct forks, per-agent accuracy | `DecisionRegistry` / `OutcomeRegistry` views |
| Protocol health | paused flags, oracle age, contract parameters | contract views |

Properties required by the brief:
- **Structured** — typed schema, validated by Zod before hashing.
- **Versioned** — `schema` field; scoring rubric version stored alongside.
- **Traceable** — each input carries `source`, `sourceRef`, `observedAt`.
- **Hashable** — `stateHash = keccak256(utf8(JCS(state)))` (RFC 8785 canonical JSON).
- **Referenced by the decision** — `stateHash` is written in `createDecision` *before* any
  agent runs; every answer leaf includes the `decisionId` which binds to that hash.

## 2. Jev Questions

Questions are explicit data, rendered in the UI and hashed — never hidden inside prompts.

```ts
interface JevQuestion {
  id: number;                          // 0..5, stable, used in Merkle leaves
  key: "ACTION" | "RISK" | "YIELD" | "SECURITY" | "MARKET" | "HISTORY";
  text: string;                        // the question, shown verbatim in the UI
  inputKeys: string[];                 // which state inputs are relevant
  rubric: RubricFactor[];              // factors that produce the deterministic score
  allowedForks: Fork[];                // what a choice for this question may be
}
interface QuestionSet { schema: "decmarkt.jev.questions/1"; questions: JevQuestion[]; assignment: Record<AgentKey, number[]> }
```

| id | key | Question |
|---|---|---|
| 0 | ACTION | Given the state, which bounded action should the vault take for the next horizon? |
| 1 | RISK | What is the downside risk to the vault's MON value over the horizon? |
| 2 | YIELD | What is the expected opportunity of increasing deployed funds over the horizon? |
| 3 | SECURITY | Are there security or operational concerns (oracle staleness, confidence width, paused contracts, network health)? |
| 4 | MARKET | What does current market information suggest about direction over the horizon? |
| 5 | HISTORY | What do historical prices and past decision outcomes suggest? |

`questionsHash = keccak256(JCS(questionSet))`, committed in `createDecision`.

## 3. Choice

A bounded action recommendation: one value of the `Fork` enum (§8). Every answer — not
only the final one — carries a choice, meaning "the fork this question's evidence alone
favours". An agent's **final** choice is its answer to question 0 (`ACTION`). The model
outputs a string label; the server maps it through a closed lookup table. Any other
string fails validation.

## 4. Score

A **deterministic** numeric evaluation, `0..10000`. The model does *not* output the score.
It outputs integer factor ratings (0–4) for the rubric factors of that question, each with
the state input keys it relied on. The server computes:

```
score = round( 10000 × Σ(weight_f × rating_f) / (4 × Σ weight_f) )
```

Weights are part of the versioned question set, so the same ratings always yield the same
score, and anyone can recompute it from the published answer. For the `ACTION` question,
the score means *strength of evidence for the chosen fork*; the engine uses it as the
minimum-conviction gate for DERISK/DEPLOY.

## 5. Probability

The agent's confidence that its choice will be the correct fork under the Verify rule
(§10), in basis points, clamped to `[100, 9900]` (no certainty claims). It is economically
meaningful: it weights the agent's vote in aggregation and scales its reward or penalty in
settlement, so overconfidence costs bond.

## 6. Reason

Human-readable explanation, max 600 chars, referencing state input keys. Stored in the
payload store; `reasonHash = keccak256(utf8(reason))` is on-chain.

## 7. Parallel Decisions

Five logical agents with distinct roles, rubric emphasis, and on-chain identities:

| Agent | Primary question | Operator key (server env) |
|---|---|---|
| Risk Analyst | RISK | `AGENT_RISK_KEY` |
| Yield Analyst | YIELD | `AGENT_YIELD_KEY` |
| Security Analyst | SECURITY | `AGENT_SECURITY_KEY` |
| Market Analyst | MARKET | `AGENT_MARKET_KEY` |
| Historical Analyst | HISTORY | `AGENT_HISTORY_KEY` |

Independence guarantees:
- Each agent is a **separate model call** with its own role instructions, the same state,
  and the same question set. No agent sees another agent's output.
- Calls run concurrently (`Promise.allSettled`); one failure does not affect others.
- Each agent submits from **its own operator address** in its own transaction, so each
  decision is independently attributable and independently settled.
- Outputs are never merged by a model. Aggregation is on-chain integer math (§9 of
  CONTRACT_SPEC.md).
- Each run records: provider, model id, rubric version, latency, validation result, and
  the hash of the raw model output.

## 8. Bounded Forks

```solidity
enum Fork { NO_ACTION, DERISK, DEPLOY, ESCALATE }   // 0,1,2,3 — fixed at compile time
```

| Fork | Brief name | Effect |
|---|---|---|
| `NO_ACTION` | NO_ACTION | Nothing moves; start price still recorded so the decision is verifiable |
| `DERISK` | ACTION_A | Move `min(actionBps × ACTIVE, maxMove)` ACTIVE → RESERVE |
| `DEPLOY` | ACTION_B | Move `min(actionBps × RESERVE, maxMove)` RESERVE → ACTIVE |
| `ESCALATE` | ESCALATE | No automatic action; a GUARDIAN picks NO_ACTION/DERISK/DEPLOY before a deadline, else NO_ACTION |

Bounds enforced in three places: Zod schema (server), `allowedForks` bitmask per decision
(contract), and `ExecutionVault` having exactly one code path per fork with parameters set
by the admin — never by the AI. No fork accepts calldata, addresses or amounts from agents.

## 9. Batch Decisions

One round is a batch of related decisions. Every answer is a full Jev decision with
provenance:

```
leaf = keccak256(abi.encode(
  decisionId, agentId, questionId, choice, score, probability, reasonHash
))
answersRoot = MerkleRoot(leaves of this agent)      // OpenZeppelin StandardMerkleTree
```

Default assignment: each agent answers its primary question and question 0 (ACTION).
The batch therefore holds 10 answers; the matrix `state × question × agent × choice ×
score × probability × reason` is fully reconstructible. The ACTION answer is also stored
in contract storage in plain form; any other answer can be proven against `answersRoot`
with a Merkle proof, and the UI does so in the audit view. Aggregation never discards the
per-agent submissions: they stay in storage and events.

## 10. Action

The approved fork (from `DecisionEngine`) is executed by `ExecutionVault.execute(id, …)`.
Execution is permissionless once approved, because the action is already fully determined
by contract state — the caller supplies only a Pyth price update, which is
signature-verified. The start price and its publish time are recorded.

## 11. Verify

Two distinct verifications:

1. **Outcome verification (economic).** After `executedAt + horizon`, anyone calls
   `OutcomeRegistry.resolve(id, pythUpdate)`. The contract verifies the Pyth update and
   requires `publishTime ∈ [executedAt + horizon, executedAt + horizon + tolerance]`.
   ```
   move = (endPrice − startPrice) × 10000 / startPrice   (bps)
   correctFork = move < −band ? DERISK : move > band ? DEPLOY : NO_ACTION
   ```
   Settlement follows deterministically (CONTRACT_SPEC.md §10).
2. **Integrity verification (audit).** The browser recomputes `stateHash`,
   `questionsHash`, each `reasonHash`, each answer leaf and each `answersRoot` from the
   published payloads and compares them to chain. Results are shown per item as
   `VERIFIED` / `MISMATCH` / `UNAVAILABLE`.

## 12. What Jev does not do

- It does not hold keys, sign, choose addresses or build calldata.
- It does not decide the protocol outcome, the threshold result, or settlement.
- It does not invent inputs; a missing input is `status: "unavailable"` with a note.
