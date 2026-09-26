# Contract Specification

Solidity `^0.8.24`, Foundry, OpenZeppelin v5 (`AccessControl`, `Pausable`,
`ReentrancyGuard`, `MerkleProof`), Pyth SDK (`IPyth`, `PythStructs`).
Types and errors are shared via `src/lib/DecTypes.sol` (see DATA_MODEL.md §2).

## 1. Contracts and responsibilities

| Contract | Owns | Does not |
|---|---|---|
| `DecisionRegistry` | agents, bonds, reward pool, decision records, lifecycle status, submissions | aggregate, execute, read prices |
| `DecisionEngine` | aggregation, threshold, approval, guardian escalation | hold funds |
| `ExecutionVault` | treasury MON, ACTIVE/RESERVE buckets, bounded actions, start price | decide what to do |
| `OutcomeRegistry` | outcome verification (Pyth), correct fork, settlement computation | hold bonds |

Status writes are exclusive: only the contract responsible for a transition can make it
(enforced by roles on `DecisionRegistry._setStatus`).

## 2. Roles

| Role | Holder | Can |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | deployer (demo), multisig later | set parameters within hard caps, pause, grant roles |
| `PROPOSER_ROLE` | server proposer key | `createDecision`, `openDecision`, `cancel` (before AGGREGATED) |
| `GUARDIAN_ROLE` | human wallet | resolve ESCALATE |
| `ENGINE_ROLE` | `DecisionEngine` | set AGGREGATED / APPROVED / CANCELLED(quorum) |
| `VAULT_ROLE` | `ExecutionVault` | set EXECUTED |
| `OUTCOME_ROLE` | `OutcomeRegistry` | set RESOLVED, apply settlement |
| agent operator | one address per agent | `submit` for its own agentId |

Agent operators are identified by `msg.sender`. `tx.origin` is never used.

## 3. Lifecycle

```
          createDecision          openDecision              aggregate
 NONE ───────────────► CREATED ──────────────► OPEN ─────────────────► AGGREGATED
                          │                     │                        │   │
                  cancel  │             cancel  │   quorum not met       │   │ guardianDecide /
                          ▼                     ▼   (in aggregate)       │   │ finalizeEscalation
                      CANCELLED ◄───────────────┴────────────────────────┘   ▼
                                                                          APPROVED
                                                                             │ execute
                                                                             ▼
                                                                          EXECUTED
                                                                             │ resolve (≥ horizon)
                                                                             ▼
                                                                          RESOLVED
```

| From | To | Function | Caller | Guard |
|---|---|---|---|---|
| NONE | CREATED | `Registry.createDecision` | PROPOSER | unique `stateHash`, valid config within caps |
| CREATED | OPEN | `Registry.openDecision` | PROPOSER | ≥ quorum active agents with free bond ≥ lock |
| OPEN | AGGREGATED(+APPROVED) | `Engine.aggregate` | anyone | `now > deadline` or all participants submitted; quorum met |
| OPEN | CANCELLED | `Engine.aggregate` | anyone | past deadline and quorum not met → locks released, no penalties |
| AGGREGATED | APPROVED | `Engine.guardianDecide` | GUARDIAN | guardian required, before `guardianDeadline`, fork ∈ {NO_ACTION, DERISK, DEPLOY} ∩ allowed |
| AGGREGATED | APPROVED | `Engine.finalizeEscalation` | anyone | after `guardianDeadline` → NO_ACTION |
| APPROVED | EXECUTED | `Vault.execute` | anyone | valid Pyth update, cooldown elapsed |
| EXECUTED | RESOLVED | `Outcome.resolve` | anyone | Pyth publishTime inside resolution window |
| CREATED/OPEN | CANCELLED | `Registry.cancel` | PROPOSER/ADMIN | — |

`aggregate` performs AGGREGATED and, when no guardian is needed, APPROVED in the same
transaction; both transitions are recorded with the same block number.

## 4. DecisionRegistry

```solidity
// agents
function registerAgent(address operator, bytes32 nameHash, string calldata uri) external onlyRole(ADMIN) returns (uint16);
function setAgentActive(uint16 agentId, bool active) external onlyRole(ADMIN);
function depositBond(uint16 agentId) external payable;                       // anyone may fund
function withdrawBond(uint16 agentId, uint256 amount) external nonReentrant; // operator only, free bond only
function fundRewardPool() external payable;

// decisions
function createDecision(bytes32 stateHash, bytes32 questionsHash, DecisionConfig calldata cfg) external onlyRole(PROPOSER) returns (uint256 id);
function openDecision(uint256 id) external onlyRole(PROPOSER);   // snapshots participants, locks bonds, reserves roundReward
function submit(uint256 id, uint16 agentId, Fork choice, uint16 score, uint16 probability, bytes32 reasonHash, bytes32 answersRoot) external;
function cancel(uint256 id) external;

// restricted
function setStatus(uint256 id, Status s) external;               // ENGINE/VAULT/OUTCOME, transition-checked
function applySettlement(uint256 id, SettlementLine[] calldata lines, uint256 toRewardPool) external onlyRole(OUTCOME);

// views
function getDecision(uint256 id) external view returns (Decision memory);
function getSubmission(uint256 id, uint16 agentId) external view returns (Submission memory);
function getAgent(uint16 agentId) external view returns (Agent memory);
function decisionCount() external view returns (uint256);
function verifyAnswer(uint256 id, uint16 agentId, bytes32[] calldata proof, bytes32 leaf) external view returns (bool);
```

`submit` checks, in order: status == OPEN · `block.timestamp <= deadline` ·
`msg.sender == agents[agentId].operator` · agent is a participant · not already submitted
· choice allowed by mask · `score <= 10000` · `100 <= probability <= 9900` · non-zero hashes.

## 5. DecisionEngine

```solidity
function aggregate(uint256 id) external whenNotPaused;
function guardianDecide(uint256 id, Fork fork) external onlyRole(GUARDIAN);
function finalizeEscalation(uint256 id) external;
function getAggregation(uint256 id) external view returns (Aggregation memory);
```

### Aggregation (pure integer math, reproduced in `web/lib/decmarkt/aggregate.ts` for preview only)

```
for each participant i that submitted:
    rep_i   = (correct_i + 1) × 10000 / (submitted_i + 2)        // Laplace-smoothed accuracy, 0..10000
    w_i     = probability_i × rep_i / 10000
    support[choice_i] += w_i
total   = Σ support
leading = argmax(support); ties → safest by order NO_ACTION > ESCALATE > DERISK > DEPLOY

passed  = submissions ≥ quorum
          ∧ support[leading] × 10000 ≥ thresholdBps × total
          ∧ (leading ∈ {DERISK, DEPLOY} ⇒ avgScore(submitters choosing leading) ≥ minActionScore)

if !passed                → approved = NO_ACTION            (fail-safe, still executed & settled)
elif leading == ESCALATE  → guardianRequired, guardianDeadline = now + GUARDIAN_WINDOW
else                      → approved = leading
```

## 6. ExecutionVault

```solidity
function deposit() external payable;                              // treasury funding → RESERVE
function execute(uint256 id, bytes[] calldata pythUpdate) external payable nonReentrant whenNotPaused;
function balances() external view returns (uint256 active, uint256 reserve);
function getExecution(uint256 id) external view returns (Execution memory);
function setActionParams(uint16 actionBps, uint256 maxMove, uint64 cooldown) external onlyRole(ADMIN); // hard caps: actionBps ≤ 2500
```

`execute`:
1. require registry status == APPROVED; read `approved` from engine (caller cannot choose it).
2. `pyth.parsePriceFeedUpdates{value: fee}(update, [MON_USD], now − 60, now)` → start price.
3. apply exactly one branch:
   - `NO_ACTION` → no movement
   - `DERISK` → `amt = min(active × actionBps / 1e4, maxMove)`; active −= amt; reserve += amt
   - `DEPLOY` → `amt = min(reserve × actionBps / 1e4, maxMove)`; reserve −= amt; active += amt
4. store `Execution`, set EXECUTED, refund excess `msg.value`.

There is no `call`, `delegatecall`, or user-supplied target anywhere in the vault. The
only value transfers are Pyth fee payment (to the fixed Pyth address) and refund to
`msg.sender`. Admin withdrawal of treasury exists only while paused and emits an event.

## 7. OutcomeRegistry

```solidity
function resolve(uint256 id, bytes[] calldata pythUpdate) external payable nonReentrant;
function getOutcome(uint256 id) external view returns (Outcome memory);
function getSettlement(uint256 id, uint16 agentId) external view returns (SettlementLine memory);
function previewSettlement(uint256 id, Fork correctFork) external view returns (SettlementLine[] memory);
```

`resolve`:
1. status == EXECUTED; `t0 = executedAt + horizon`; `block.timestamp >= t0`.
2. `parsePriceFeedUpdates(update, [MON_USD], t0, t0 + RESOLUTION_TOLERANCE)` — the price
   must have been published inside the window; signature verified by Pyth.
3. `moveBps = (end − start) × 10000 / start` (same expo enforced).
4. `correctFork` per JEV_INTEGRATION.md §11.
5. compute settlement (§10) → `registry.applySettlement` → status RESOLVED.

If no valid update is submitted within `t0 + RESOLUTION_TOLERANCE + GRACE`, anyone may
call `voidOutcome(id)`: all locks released, no rewards or penalties, status RESOLVED with
`correctFork` unset and flagged `void`.

## 8. Parameters (demo defaults; admin-settable within caps)

| Parameter | Default | Cap |
|---|---|---|
| `submissionWindow` | 180 s | 1 h |
| `horizon` | 180 s | 7 d |
| `bandBps` | 10 (0.10 %) | 1000 |
| `thresholdBps` | 6000 | ≥ 5001 |
| `minActionScore` | 5500 | — |
| `quorum` | 4 of 5 | ≥ 3 |
| `lockPerAgent` | 0.05 MON | — |
| `slashBps` | 3000 | 5000 |
| `missPenaltyBps` | 1000 | 2000 |
| `roundReward` | 0.02 MON | pool balance |
| `actionBps` / `maxMove` | 1000 / 0.5 MON | 2500 / — |
| `GUARDIAN_WINDOW` | 120 s | — |
| `RESOLUTION_TOLERANCE` | 60 s | — |

## 9. Aggregation

See §5. Chosen for: determinism, no floating point, rewards calibrated confidence, and
a single safe default on every failure path.

## 10. Settlement

For each participant with lock `L`, probability `p`:

| Result | Condition | Penalty | Reward |
|---|---|---|---|
| CORRECT | choice == correctFork | 0 | `pool × p / Σp_correct` |
| WRONG | choice ∈ {NO_ACTION, DERISK, DEPLOY} ≠ correctFork | `L × slashBps × p / 1e8` | 0 |
| NEUTRAL | choice == ESCALATE | 0 | 0 |
| MISSED | no submission | `L × missPenaltyBps / 1e4` | 0 |

```
pool = Σ penalties + roundReward
every lock is released; penalties are deducted from the released amount
if no CORRECT agent: pool → reward pool
integer rounding dust → reward pool
agent.submitted++ for CORRECT/WRONG; agent.correct++ for CORRECT; agent.missed++ for MISSED
```

Invariant (tested): `Σ lockReleased − Σ penalty + Σ reward + toRewardPool == Σ locks + roundReward`.
Rewards and penalties change `Agent.bond` balances (pull-based withdrawal); no push transfers.

## 11. Events

```solidity
event AgentRegistered(uint16 indexed agentId, address indexed operator, bytes32 nameHash);
event BondChanged(uint16 indexed agentId, int256 delta, uint256 bond, uint256 locked);
event DecisionCreated(uint256 indexed id, bytes32 stateHash, bytes32 questionsHash, address proposer);
event StatusChanged(uint256 indexed id, Status from, Status to);
event DecisionOpened(uint256 indexed id, uint16[] participants, uint64 deadline, uint256 roundReward);
event Submitted(uint256 indexed id, uint16 indexed agentId, Fork choice, uint16 score, uint16 probability, bytes32 reasonHash, bytes32 answersRoot);
event Aggregated(uint256 indexed id, uint256[4] support, Fork leading, bool passed, Fork approved, bool guardianRequired);
event GuardianDecided(uint256 indexed id, address guardian, Fork fork);
event Executed(uint256 indexed id, Fork action, uint256 amountMoved, int64 startPrice, uint64 startPublishTime);
event Resolved(uint256 indexed id, int64 endPrice, int256 moveBps, Fork correctFork);
event Settled(uint256 indexed id, uint16 indexed agentId, uint8 result, uint256 penalty, uint256 reward);
```

## 12. Custom errors (subset)

`Unauthorized()`, `InvalidTransition(Status from, Status to)`, `DeadlinePassed()`,
`DeadlineNotReached()`, `AlreadySubmitted()`, `NotParticipant()`, `ForkNotAllowed(Fork)`,
`OutOfRange()`, `DuplicateState()`, `InsufficientBond()`, `QuorumUnavailable()`,
`CooldownActive()`, `PriceOutsideWindow()`, `ExpoMismatch()`, `ParamAboveCap()`.

## 13. Tests (Foundry)

- Full lifecycle happy paths for each fork, with a mock Pyth.
- Every invalid transition reverts with `InvalidTransition`.
- Submit guards: late, duplicate, wrong operator, non-participant, disallowed fork, ranges.
- Aggregation: ties, threshold edge (exactly `thresholdBps`), quorum miss, score gate, ESCALATE + guardian + timeout.
- Settlement invariant fuzzed over probabilities, choices and outcomes.
- Pyth window: early / late / stale updates revert.
- Access control on every restricted function; reentrancy on withdrawals.
- Fork test against the real Pyth on Monad Testnet (read-only) for update parsing.
