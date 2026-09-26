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

## 2. On-chain (Solidity, `DecTypes.sol`)

```solidity
enum Status { NONE, CREATED, OPEN, AGGREGATED, APPROVED, EXECUTED, RESOLVED, CANCELLED }
enum Fork   { NO_ACTION, DERISK, DEPLOY, ESCALATE }

struct Agent {
    address operator;        // signs submissions; unique
    bytes32 nameHash;        // keccak256("Risk Analyst")
    string  metadataURI;     // payload store URL for role + rubric
    bool    active;
    uint256 bond;            // free bond (wei)
    uint256 locked;          // bond locked in open decisions
    uint32  submitted;       // resolved, non-neutral submissions
    uint32  correct;
    uint32  missed;
}

struct DecisionConfig {
    uint64  submissionWindow;   // seconds after OPEN
    uint64  horizon;            // seconds after EXECUTED
    uint16  bandBps;            // flat band for outcome
    uint16  thresholdBps;       // winning share of weighted support
    uint16  minActionScore;     // min avg score for DERISK/DEPLOY
    uint8   quorum;             // min submissions
    uint8   allowedForks;       // bitmask over Fork
    uint256 lockPerAgent;       // wei locked per participant
}

struct Decision {
    uint256 id;
    bytes32 stateHash;
    bytes32 questionsHash;
    address proposer;
    Status  status;
    DecisionConfig config;
    uint64  createdAt; uint64 openedAt; uint64 deadline;
    uint16[] participants;             // agent ids snapshot at OPEN
    uint256 roundReward;               // reserved from reward pool at OPEN
    uint64[8] statusBlock;             // block number of each transition → tx lookup via logs
}

struct Submission {                     // key: (decisionId, agentId)
    Fork    choice;
    uint16  score;
    uint16  probability;
    bytes32 reasonHash;
    bytes32 answersRoot;
    uint64  submittedAt;
}

struct Aggregation {                    // DecisionEngine
    uint256[4] support;                 // weighted support per fork
    uint256 totalSupport;
    Fork    leading;
    bool    thresholdPassed;
    Fork    approved;                   // what will execute
    bool    guardianRequired;
    uint64  guardianDeadline;
    uint8   submissions;
}

struct Execution {                      // ExecutionVault
    Fork    action;
    uint256 amountMoved;
    uint256 activeAfter; uint256 reserveAfter;
    int64   startPrice; int32 expo; uint64 startPublishTime;
    uint64  executedAt;
}

struct Outcome {                        // OutcomeRegistry
    int64   endPrice; uint64 endPublishTime;
    int256  moveBps;
    Fork    correctFork;
    uint64  resolvedAt;
}

struct SettlementLine {                 // per (decisionId, agentId), emitted + stored
    uint8   result;                     // 0 CORRECT, 1 WRONG, 2 NEUTRAL, 3 MISSED
    uint256 lockReleased;
    uint256 penalty;
    uint256 reward;
}
```

Status is ordered so the UI can render the lifecycle rail directly from `statusBlock`.

## 3. Off-chain payloads (TypeScript, `web/lib/jev/types.ts`)

`JevState`, `StateInput`, `JevQuestion`, `QuestionSet` — see JEV_INTEGRATION.md §1–2.

```ts
type Fork = "NO_ACTION" | "DERISK" | "DEPLOY" | "ESCALATE";
type AgentKey = "RISK" | "YIELD" | "SECURITY" | "MARKET" | "HISTORY";

interface FactorRating { factor: string; rating: 0 | 1 | 2 | 3 | 4; evidence: string[] /* state input keys */ }

interface JevAnswer {                // one Jev decision
  decisionId: string;                // uint256 as decimal string
  agentId: number;
  questionId: number;
  choice: Fork;
  score: number;                     // computed, never model-provided
  probability: number;               // bps
  reason: string;
  reasonHash: Hex;
  factors: FactorRating[];
  leaf: Hex;
}

interface AgentRun {                  // provenance of one parallel decision
  decisionId: string;
  agentId: number;
  agentKey: AgentKey;
  provider: string;                   // e.g. "anthropic"
  model: string;                      // exact model id returned by the API
  rubricVersion: string;
  startedAt: number; finishedAt: number;
  rawOutputHash: Hex;                 // keccak256 of raw model text
  validation: { ok: true } | { ok: false; errors: string[] };
  answers: JevAnswer[];               // empty if validation failed
  answersRoot: Hex | null;
  submitTx: Hex | null;               // filled after receipt, from chain
}
```

Zod schema for model output (the only shape accepted from the AI):

```ts
const ModelAnswer = z.object({
  questionId: z.number().int().min(0).max(5),
  choice: z.enum(["NO_ACTION", "DERISK", "DEPLOY", "ESCALATE"]),
  probability: z.number().int().min(100).max(9900),
  factors: z.array(z.object({ factor: z.string(), rating: z.number().int().min(0).max(4), evidence: z.array(z.string()).max(8) })),
  reason: z.string().min(20).max(600),
}).strict();
const ModelOutput = z.object({ answers: z.array(ModelAnswer).min(1).max(6) }).strict();
```

Post-validation checks: questionIds equal the agent's assignment exactly; factor names
equal the rubric exactly; evidence keys exist in the state; choice ∈ question's
`allowedForks`. Any failure → run marked invalid → no submission (agent is recorded as
MISSED on-chain and settled as such).

## 4. Payload store layout (content-addressed)

```
states/{stateHash}.json              JevState (JCS bytes)
questions/{questionsHash}.json       QuestionSet
runs/{decisionId}/{agentId}.json     AgentRun (answers include reasons)
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
| choice, score, probability per agent | `DecisionRegistry.getSubmission` |
| reason, factors, non-ACTION answers | payload store, checked against `reasonHash` / `answersRoot` |
| state inputs | payload store, checked against `stateHash` |
| support, threshold, approved fork | `DecisionEngine.getAggregation` |
| moved amount, bucket balances | `ExecutionVault.getExecution`, `balances()` |
| prices, move, correct fork | `OutcomeRegistry.getOutcome` |
| rewards, penalties | `OutcomeRegistry.getSettlement` |
| agent bond, accuracy | `DecisionRegistry.getAgent` |
| model id, latency | AgentRun payload (labelled "reported by server") |
