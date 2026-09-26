# Data Model

Three stores, one rule: **the chain is the source of truth; off-chain payloads are only
trusted after their hash matches the chain.**

| Store | Holds | Trust |
|---|---|---|
| Monad contracts | lifecycle, hashes, submissions (choice/score/probability), aggregation, execution, outcome, bonds | authoritative |
| Payload store (Vercel Blob, content-addressed) | state JSON, question set, reasons, factor ratings, run metadata | verified against on-chain hashes |
| Server memory | nothing durable | — |

## 1. Units and encodings

| Quantity | Type | Unit |
|---|---|---|
| score | `uint16` | 0–10000 |
| probability | `uint16` | bps, 100–9900 |
| thresholds, bands, slash rates | `uint16` | bps |
| MON amounts | `uint256` | wei |
| prices | `int64` + `int32 expo` | Pyth native |
| timestamps | `uint64` | unix seconds |
| hashes | `bytes32` | keccak256 |

Canonical JSON: RFC 8785 (JCS). Hash of text: `keccak256(utf8(text))`.

## 2. On-chain (Solidity, `contracts/src/lib/DecTypes.sol`)

```solidity
enum Status { NONE, CREATED, OPEN, AGGREGATED, APPROVED, EXECUTED, RESOLVED, CANCELLED }
enum Choice { NO_ACTION, ACTION_A, ACTION_B, ESCALATE }   // ACTION_A = DERISK, ACTION_B = DEPLOY
enum SettlementResult { CORRECT, WRONG, NEUTRAL, MISSED }

struct DecisionConfig { uint64 submissionWindow; uint64 horizon; uint16 bandBps; uint16 thresholdBps;
                        uint16 minActionScore; uint8 quorum; uint8 allowedForks; uint8 questionCount;
                        uint256 lockPerAgent; }
struct Decision { uint256 id; bytes32 stateHash; bytes32 questionSetHash; address proposer; Status status;
                  DecisionConfig config; uint64 createdAt; uint64 openedAt; uint64 deadline;
                  uint16[] participants; uint256 roundReward; uint64[8] statusBlock; }
struct Agent { address operator; bytes32 nameHash; string metadataURI; bool active;
               uint256 bond; uint256 locked; uint32 submitted; uint32 correct; uint32 missed; }
struct Answer { uint8 questionId; uint8 choice; uint16 score; uint16 probability; bytes32 reasonHash; }
struct Submission { uint16 agentId; uint8 questionId; Choice choice; uint16 score; uint16 probability;
                    bytes32 reasonHash; uint256 bond; uint64 submittedAt; }   // key (id, agentId, questionId)
struct Aggregation { uint256[4] support; uint256 totalSupport; Choice leading; bool thresholdPassed;
                     Choice approved; bool guardianRequired; uint64 guardianDeadline; uint8 submissions; }
struct Execution { Choice action; uint256 amountMoved; uint256 activeAfter; uint256 reserveAfter;
                   int64 startPrice; int32 expo; uint64 startPublishTime; uint64 executedAt; }
struct Outcome { Choice expectedAction; Choice observedResult; bool success; int256 outcomeValue;
                 int64 startPrice; int64 endPrice; int32 expo; uint64 endPublishTime; bool isVoid; uint64 resolvedAt; }
struct SettlementLine { uint16 agentId; SettlementResult result; uint256 lockReleased; uint256 penalty; uint256 reward; }
```

The web ABIs are generated from the compiled artifacts (`web/scripts/sync-abis.mjs`), so
TypeScript reads use exactly these field names. The TS model calls the choices
`DERISK` / `DEPLOY`; the numeric encoding is identical.

## 3. Domain model (TypeScript, `web/lib/model/`)

One set of types is shared by the Jev layer, the DecMarkt math, the chain read layer
and the UI. Jev functions (`web/lib/jev/`) produce these objects; nothing else defines
parallel shapes.

### 3.1 Primitives (`primitives.ts`)

`Choice`, `Score` and `Probability` are first-class, branded types. A plain number is
not assignable to `Score` or `Probability`; values enter only through parsers that
enforce the protocol ranges.

```ts
type Choice      = "NO_ACTION" | "DERISK" | "DEPLOY" | "ESCALATE";
type Score       = number & Brand<"Score">;        // int 0..10000, computed from rubric
type Probability = number & Brand<"Probability">;  // int 100..9900 bps
interface JevPrimitives { choice: Choice; score: Score; probability: Probability }
```

### 3.2 State (`state.ts`)

```ts
interface StateRecord {
  stateId: `st_${string}`;          // from content, excluding id and hash
  version: "decmarkt.jev.state/1";
  source: StateSource[];            // every source that contributed, sorted
  timestamp: UnixSeconds;
  data: { subject: StateSubject; inputs: StateInput[] };   // inputs sorted by key
  hash: Hex;                        // keccak256(JCS(record without hash)) = Decision.stateHash
}
```

### 3.3 Questions (`question.ts`)

```ts
interface Question {
  questionId: `qn_${string}`;       // keccak(JCS{stateId, index, category, text}), standalone id
  stateId: StateId;
  text: string;
  category: "ACTION" | "RISK" | "YIELD" | "SECURITY" | "MARKET" | "HISTORY";
  createdAt: UnixSeconds;
  index: number;                    // uint8 slot used in on-chain Merkle leaves
  inputKeys: string[]; rubric: RubricFactor[]; allowedForks: Choice[];
}
interface QuestionSet { version; rubricVersion; stateId; createdAt; questions: Question[];
                        assignment: Record<AgentKey, QuestionId[]>; hash: Hex /* = Decision.questionsHash */ }
```

### 3.4 Agent decisions, parallel runs, batches (`decision.ts`)

```ts
interface AgentDecision extends JevPrimitives {
  agentId; decisionId; questionId; questionIndex;
  reason: string; reasonHash: Hex; factors: FactorRating[];
  bond: Wei;                        // this agent's lock for the decision (shared by its batch)
  timestamp: UnixSeconds;
}
interface DecisionBatch { batchId: `bt_${decisionId}_${agentId}`; decisionId; stateId; agentId;
                          decisions: AgentDecision[]; answersRoot: Hex;
                          leaves: { questionId; questionIndex; leafHash; proof }[] }
interface AgentRun { decisionId; stateId; agentId; agentKey; provider; model; rubricVersion;
                     startedAt; finishedAt; rawOutputHash; validation; batch; final }
interface ParallelDecisions { decisionId; stateId; questionSetHash; runs: Record<AgentKey, AgentRun> }
interface SubmissionRecord extends JevPrimitives { decisionId; agentId; reasonHash; answersRoot; submittedAt }
```

`ParallelDecisions.runs` is keyed by agent: exactly one independent run per agent, never
merged. Every question an agent answers is its own `AgentDecision` and its own Merkle
leaf, so question-level provenance survives batching and aggregation.

### 3.5 Bounded forks and actions (`action.ts`)

`ACTION_SPACE` is a frozen, compile-time table with one `ProtocolAction` per fork
(contract `ExecutionVault`, entrypoint `execute`, admin-set parameters, effect).
`ForkSpace` is the per-decision subset (always includes `NO_ACTION`).

```ts
interface Action {
  decisionId; fork: "NO_ACTION" | "DERISK" | "DEPLOY";
  definition: ProtocolAction;       // entry of ACTION_SPACE
  approvedBy: "engine" | "guardian" | "fail-safe" | "guardian-timeout";
  params: { actionBps; maxMove } | null;
  execution: { amountMoved; after; startPrice; executedAt; tx } | null;
  calldata?: never;                 // an Action can never carry calldata
}
```

### 3.6 Aggregation (`aggregation.ts`)

`Aggregation` keeps each agent's contribution (`inputs`: choice, score, probability,
reputation, weight) next to the per-fork support, gates, verdict and approved fork.

### 3.7 Verify / Outcome (`outcome.ts`)

```ts
interface Outcome {
  decisionId;
  expectedAction: "NO_ACTION" | "DERISK" | "DEPLOY";           // the executed action
  observedResult: { start; end; moveBps; bandBps; correctFork } | null;   // null ⇔ void
  success: boolean | null;                                     // expectedAction === correctFork
  verificationSource: { kind: "pyth"; chainId; contract; feedId; window } | { kind: "preview" };
  status: "VERIFIED" | "VOID";
  timestamp: UnixSeconds;
  tx: TxRef | null;
}
```

### 3.8 Accountability (`accountability.ts`)

```ts
type SettlementStatus = "NOT_LOCKED" | "LOCKED" | "SETTLED" | "RELEASED" | "VOID";
interface SettlementLine { decisionId; agentId; bond: Wei; settlementStatus;
                           result: "CORRECT" | "WRONG" | "NEUTRAL" | "MISSED" | null;
                           reward: Wei; penalty: Wei; net: bigint }
interface Settlement { decisionId; settlementStatus; lines; roundReward; toRewardPool; tx }
```

### 3.9 Transactions (`transaction.ts`)

`TxRef { chainId, hash, blockNumber, contract, functionName }` — the contract and
function are decoded from the transaction's calldata, never assumed.
`LifecycleTransition { status, blockNumber, tx }`.

### 3.10 Model output (`web/lib/validation/model-output.ts`)

The only shape accepted from an AI model; answers refer to questions by `questionIndex`:

```ts
{ answers: [{ questionIndex: 0..5, choice: Choice, probability: 100..9900,
              factors: [{ factor, rating: 0..4, evidence: stateKey[] }], reason: 20..600 chars }] }
```

Post-validation: exact question coverage, exact rubric factors, evidence keys that exist
in the state, choice inside the question's allowed forks. Any failure → run invalid → no
submission (MISSED on-chain).

## 4. Payload store layout (content-addressed)

```
states/{stateHash}.json              StateRecord (JCS bytes)
questions/{questionsHash}.json       QuestionSet
runs/{decisionId}/{agentId}.json     AgentRun (batch includes every AgentDecision with reason)
agents/{agentId}.json                role description + rubric (metadataURI)
```

Files are written once; the key is the hash, so overwriting with different content is
detectable. If the store is unreachable, the audit view shows on-chain fields and marks
text fields *unavailable*.

## 5. Where each UI value comes from

| UI value | Source |
|---|---|
| status, timestamps, deadlines | `DecisionRegistry.getDecision` |
| tx hash per lifecycle step | `eth_getLogs` at `statusBlock[s]` filtered by event + decisionId |
| choice, score, probability, bond per agent and question | `DecisionRegistry.getSubmission(id, agent, question)` |
| reason text, factor ratings | payload store, checked against each on-chain `reasonHash` |
| state inputs | payload store, checked against `stateHash` |
| support, threshold, approved fork | `DecisionEngine.getAggregation` |
| moved amount, bucket balances | `ExecutionVault.getExecution`, `balances()` |
| expected action, observed result, success, outcome value, prices | `OutcomeRegistry.getOutcome` |
| rewards, penalties | `OutcomeRegistry.getSettlement` |
| agent bond, accuracy | `DecisionRegistry.getAgent` |
| model id, latency | AgentRun payload (labelled "reported by server") |

## 6. Provenance (`web/lib/model/provenance.ts`)

```
State → Question → Agent → Decision → Aggregation → Action → Transaction → Outcome → Settlement
```

`DecisionProvenance` holds every link for one decision:

| Link | Field | Present from |
|---|---|---|
| State | `state: StateRecord \| StateRef` | chain (hash) + payload store (full) |
| Question | `questions: QuestionSet \| QuestionSetRef` | chain (hash) + payload store (full) |
| Agent | `agents: AgentRef[]` | registry |
| Decision | `submissions: SubmissionRecord[]`, `parallel: ParallelDecisions` | chain / payload store |
| Aggregation | `aggregation` | DecisionEngine |
| Action | `action` | DecisionEngine + ExecutionVault |
| Transaction | `decision.transitions[].tx`, `action.execution.tx` | logs + decoded transactions |
| Outcome | `outcome` | OutcomeRegistry |
| Settlement | `settlement` | OutcomeRegistry |

- `traceDecision(p, agentId)` returns the nine steps for one agent, each marked
  `present`, `reference-only` (hash known, payload not loaded) or `pending`.
- `validateProvenance(p)` checks every link against its neighbours (hashes, ids,
  participants, answersRoot vs. chain, action vs. approved fork, outcome vs. executed
  action, settlement coverage) and returns the list of violations. The decision audit
  page runs it on every load and shows the result.

