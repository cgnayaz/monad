# Contract Specification

Solidity `0.8.28` (via-IR), Foundry, OpenZeppelin v5.4 (`AccessControl`, `Pausable`,
`ReentrancyGuard`), Pyth SDK v2.2 (`IPyth`, `PythStructs`, `MockPyth` in tests).
Source: `contracts/src/`. Tests: `contracts/test/` (65 tests incl. a 512-run fuzz).
Types and errors are shared via `src/lib/DecTypes.sol` (see DATA_MODEL.md §2).

## 1. Contracts and responsibilities

| Contract | Owns | Does not |
|---|---|---|
| `DecisionRegistry` | agents, bonds, reward pool, decision records, lifecycle status, submissions | aggregate, execute, read prices |
| `DecisionEngine` | aggregation, threshold, approval, guardian escalation | hold funds |
| `ExecutionVault` | treasury MON, ACTIVE/RESERVE buckets, bounded actions, start price | decide what to do |
| `OutcomeRegistry` | outcome verification (Pyth), correct fork, settlement computation | hold bonds |

Status writes are exclusive: only the contract responsible for a transition can make it
(each transition is its own role-gated function on `DecisionRegistry`).

## 2. Roles

| Role | Holder | Can |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | deployer (demo), multisig later | set parameters within hard caps, pause, grant roles |
| `PROPOSER_ROLE` | server proposer key | `createDecision`, `openDecision`, `cancel` (before AGGREGATED) |
| `GUARDIAN_ROLE` | human wallet | resolve ESCALATE |
| `ENGINE_ROLE` | `DecisionEngine` | set AGGREGATED / APPROVED / CANCELLED(quorum) |
| `VAULT_ROLE` | `ExecutionVault` | set EXECUTED |
| `OUTCOME_ROLE` | `OutcomeRegistry` | apply settlement and set RESOLVED (`settleAndResolve`) |
| agent operator | one address per agent | `submit` / `submitBatch` for its own agentId; `withdrawBond` |

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

Stores, per decision: `id`, `stateHash`, `questionSetHash`, `proposer`, `status`, `config`
(including `thresholdBps` and `questionCount`), `createdAt`, `openedAt`, `deadline`,
`participants`, `roundReward`, `statusBlock[8]`.

```solidity
// agents, bonds, rewards
function registerAgent(address operator, bytes32 nameHash, string calldata uri) external returns (uint16); // ADMIN
function setAgentActive(uint16 agentId, bool active) external;                                            // ADMIN
function depositBond(uint16 agentId) external payable;                     // anyone
function withdrawBond(uint16 agentId, uint256 amount) external;            // operator, free bond only, nonReentrant, CEI
function fundRewardPool() external payable;                                // anyone
function setRoundReward(uint256 amount) external;                          // ADMIN

// decisions
function createDecision(bytes32 stateHash, bytes32 questionSetHash, DecisionConfig calldata cfg) external returns (uint256); // PROPOSER
function openDecision(uint256 id) external;                                // PROPOSER: snapshot participants, lock bonds, reserve reward
function submit(uint256 id, uint16 agentId, Answer calldata answer) external;          // operator
function submitBatch(uint256 id, uint16 agentId, Answer[] calldata answers) external;  // operator: a Jev batch in one tx
function cancel(uint256 id) external;                                      // PROPOSER or ADMIN, CREATED/OPEN only

// restricted transitions (one function per transition)
function markAggregated(uint256 id) external;        // ENGINE   OPEN → AGGREGATED
function markApproved(uint256 id) external;          // ENGINE   AGGREGATED → APPROVED
function markCancelledNoQuorum(uint256 id) external; // ENGINE   OPEN → CANCELLED
function markExecuted(uint256 id) external;          // VAULT    APPROVED → EXECUTED
function settleAndResolve(uint256 id, SettlementLine[] calldata lines, uint256 toRewardPool) external; // OUTCOME EXECUTED → RESOLVED

// views
function getDecision(uint256 id) external view returns (Decision memory);
function getSubmission(uint256 id, uint16 agentId, uint8 questionId) external view returns (Submission memory);
function getFinalSubmission(uint256 id, uint16 agentId) external view returns (bool, Submission memory);
function getAgent(uint16 agentId) external view returns (Agent memory);
function decisionCount() / agentCount() / rewardPool() / reservedRewards() / roundReward()
function answerCount(uint256 id, uint16 agentId) / finalSubmissionCount(uint256 id)
```

**Submissions.** `Answer { questionId, choice, score, probability, reasonHash }`. Each
stored `Submission` records `agentId, questionId, choice, score, probability, reasonHash,
bond, submittedAt`. Every question an agent answers is its own on-chain record, so
question-level provenance is on-chain; the answer to question 0 (ACTION) is the agent's
final decision and the only one aggregated.

Checks, in order: status == OPEN · `block.timestamp <= deadline` (else `DeadlinePassed`) ·
`msg.sender == operator` (`NotAgentOperator`) · participant (`NotParticipant`) ·
`questionId < questionCount` (`InvalidQuestion`) · not yet answered (`AlreadySubmitted`) ·
`choice < 4` (`InvalidChoice`, checked on the raw uint8 before any enum cast) · choice in
`allowedForks` (`ChoiceNotAllowed`) · `score <= 10000` (`InvalidScore`) ·
`100 <= probability <= 9900` (`InvalidProbability`) · `reasonHash != 0` (`InvalidHash`).

**Config validation** at creation: window 1 s–1 h, horizon 1 s–7 d, band ≤ 1000,
threshold 5001–10000, minActionScore ≤ 10000, quorum 3–16, `allowedForks` ⊆ 0x0F and
includes NO_ACTION, questionCount 1–16, lockPerAgent > 0. Duplicate `stateHash` → `DuplicateState`.

**Settlement application** verifies coverage (one line per participant, in order), each
line releases exactly the lock, penalty ≤ lock, and conservation:
`roundReward + Σ penalty == toRewardPool + Σ reward`. Otherwise `InvalidSettlement`.

## 5. DecisionEngine

```solidity
function aggregate(uint256 id) external;                  // anyone
function guardianDecide(uint256 id, uint8 choice) external; // GUARDIAN
function finalizeEscalation(uint256 id) external;         // anyone, after the guardian window
function getAggregation(uint256 id) external view returns (Aggregation memory);
function approvedAction(uint256 id) external view returns (Choice); // reverts unless APPROVED or later
```

### Aggregation formula (exact; integer arithmetic, truncating division)

Jev provides Choice, Score and Probability; DecMarkt determines aggregate, threshold and
approved action. Reputation is read from the agents' on-chain records at the aggregation
block; every input is emitted (`AgentWeighted`) so the result is reproducible off-chain
(`web/lib/decmarkt/aggregate.ts` implements the same formula).

```
aggregate allowed when: status == OPEN ∧ (now > deadline ∨ finalSubmissions == |participants|)
if finalSubmissions < quorum → CANCELLED (locks and reserved reward returned)

for each participant i with a final (question 0) submission:
    rep_i   = (correct_i + 1) × 10000 / (submitted_i + 2)
    w_i     = probability_i × rep_i / 10000
    support[choice_i] += w_i
total   = Σ support
leading = first of [NO_ACTION, ESCALATE, ACTION_A, ACTION_B] with strictly the highest support
share   = total > 0 ∧ support[leading] × 10000 ≥ thresholdBps × total
score   = leading ∈ {ACTION_A, ACTION_B} ⇒ (Σ score of backers) / (number of backers) ≥ minActionScore
passed  = share ∧ score                                   (quorum already met)

!passed              → approved = NO_ACTION (fail-safe), APPROVED in the same tx
leading == ESCALATE  → AGGREGATED; GUARDIAN picks NO_ACTION/ACTION_A/ACTION_B within 120 s,
                       otherwise finalizeEscalation → NO_ACTION
otherwise            → approved = leading, APPROVED in the same tx
```

## 6. ExecutionVault

```solidity
function deposit() external payable;          // → RESERVE
function depositActive() external payable;    // → ACTIVE (initial allocation)
function execute(uint256 id, bytes[] calldata pythUpdate) external payable; // anyone; msg.value == Pyth fee
function setActionParams(uint16 actionBps, uint256 maxMove, uint64 cooldown) external; // ADMIN, actionBps ≤ 2500
function emergencyWithdraw(address payable to, uint256 amount) external;              // ADMIN, only while paused
function balances() external view returns (uint256 active, uint256 reserve);
function getExecution(uint256 id) external view returns (Execution memory);
receive() external payable;                   // always reverts (no untracked funds)
```

`execute`: status == APPROVED · cooldown elapsed · `msg.value == pyth.getUpdateFee(update)`
(exact, so no refund transfer is needed) · action read from `engine.approvedAction(id)` ·
start price from `pyth.parsePriceFeedUpdates(update, [ETH/USD], now − 10, now)` (`MAX_PRICE_AGE` = 10 s), price > 0 ·
then exactly one branch:

| Choice | Effect |
|---|---|
| NO_ACTION | nothing moves |
| ACTION_A | `amt = min(active × actionBps / 10000, maxMove)`; ACTIVE → RESERVE |
| ACTION_B | `amt = min(reserve × actionBps / 10000, maxMove)`; RESERVE → ACTIVE |

Funds never leave the vault through `execute`. There is no target, calldata or amount
parameter anywhere; the only value transfers in the contract are the Pyth fee (to the
immutable Pyth address) and the paused-only admin emergency withdrawal.

## 7. OutcomeRegistry

```solidity
function resolve(uint256 id, bytes[] calldata pythUpdate) external payable; // anyone; msg.value == fee
function voidOutcome(uint256 id) external;                                  // anyone, after the grace period
function getOutcome(uint256 id) external view returns (Outcome memory);
function getSettlement(uint256 id, uint16 agentId) external view returns (SettlementLine memory);
function previewSettlement(uint256 id, Choice observed) external view returns (SettlementLine[] memory, uint256);
function observedChoice(int256 outcomeValue, uint16 bandBps) external pure returns (Choice);
function setPenaltyParams(uint16 slashBps, uint16 missPenaltyBps) external;  // ADMIN, ≤ 5000 / ≤ 2000
```

Records per decision: `expectedAction` (executed action), `observedResult` (the choice the
observed move makes correct), `success`, `outcomeValue` (move in bps), `startPrice`,
`endPrice`, `expo`, `endPublishTime`, `isVoid`, `resolvedAt`.

```
t0           = executedAt + horizon;  resolve allowed when now ≥ t0
end price    = parsePriceFeedUpdatesUnique(update, [ETH/USD], t0, t0 + 60)
               (only the FIRST update published at or after t0 is accepted: prevPublishTime < t0;
                a later update inside the window reverts, so the price cannot be cherry-picked)
expo must equal the start expo (ExpoMismatch)
outcomeValue = (end − start) × 10000 / start
observed     = outcomeValue < −band ? ACTION_A : outcomeValue > band ? ACTION_B : NO_ACTION
success      = expectedAction == observed
```

`voidOutcome` after `t0 + 60 + 3600` (`VOID_GRACE` = 1 h) without a resolution: `isVoid = true`, every lock
returned, round reward back to the pool, status RESOLVED.

## 8. Parameters (demo defaults; admin-settable within caps)

| Parameter | Default | Cap | Where |
|---|---|---|---|
| `submissionWindow` | 180 s | 1 h | per decision |
| `horizon` | 180 s | 7 d | per decision |
| `bandBps` | 10 | 1000 | per decision |
| `thresholdBps` | 6000 | 5001–10000 | per decision |
| `minActionScore` | 5500 | 10000 | per decision |
| `quorum` | 4 of 5 | 3–16 | per decision |
| `questionCount` | 6 | 16 | per decision |
| `lockPerAgent` | 0.05 MON | `MAX_LOCK_PER_AGENT` = 1 MON | per decision |
| `roundReward` | 0.02 MON | pool balance | registry |
| `slashBps` | 3000 | 5000 | OutcomeRegistry |
| `missPenaltyBps` | 1000 | 2000 | OutcomeRegistry |
| `actionBps` / `maxMove` / `cooldown` | 1000 / 0.5 MON / 0 | 2500 / — / — | ExecutionVault |
| `GUARDIAN_WINDOW` | 120 s | constant | DecisionEngine |
| `RESOLUTION_TOLERANCE` / `VOID_GRACE` | 60 s / 1 h | constant | OutcomeRegistry |
| `MAX_PRICE_AGE` (start price) | 10 s | constant | ExecutionVault |

## 9. Aggregation

See §5. Chosen for: determinism, no floating point, rewards calibrated confidence, and a
single safe default on every failure path.

## 10. Settlement

For each participant with lock `L`; `p` is the probability of its final submission:

| Result | Condition | Penalty | Reward |
|---|---|---|---|
| CORRECT | final choice == observed | 0 | `pool × p / Σp_correct` |
| WRONG | final choice ∈ {NO_ACTION, ACTION_A, ACTION_B} ≠ observed | `L × slashBps × p / 1e8` | 0 |
| NEUTRAL | final choice == ESCALATE | 0 | 0 |
| MISSED | no final submission | `L × missPenaltyBps / 1e4` | 0 |

```
pool = Σ penalties + roundReward
every lock is released; penalties are deducted from it (bond += L − penalty + reward)
if no CORRECT agent: the whole pool → reward pool
integer rounding dust → reward pool
agent.submitted++ for CORRECT/WRONG; agent.correct++ for CORRECT; agent.missed++ for MISSED
```

Tested invariants: registry balance == Σ bonds + Σ locked + rewardPool + reservedRewards,
and a resolved decision neither creates nor destroys value (fuzzed over choices,
probabilities, skipped submissions and prices).

## 11. Events

| Contract | Events |
|---|---|
| DecisionRegistry | `AgentRegistered`, `AgentActiveSet`, `BondChanged`, `RewardPoolChanged`, `RoundRewardSet`, `DecisionCreated`, `DecisionOpened`, `StatusChanged`, `Submitted(id, agentId, questionId, choice, score, probability, bond, reasonHash)`, `Settled` |
| DecisionEngine | `AgentWeighted(id, agentId, choice, score, probability, reputationBps, weight)`, `Aggregated`, `QuorumFailed`, `GuardianDecided`, `EscalationTimedOut` |
| ExecutionVault | `Deposited`, `ActionParamsSet`, `Executed`, `EmergencyWithdrawal` |
| OutcomeRegistry | `PenaltyParamsSet`, `OutcomeRecorded`, `OutcomeVoided` |

## 12. Custom errors

Registry: `InvalidTransition(from, to)`, `UnknownDecision`, `UnknownAgent`, `NotAgentOperator`,
`NotParticipant`, `DeadlinePassed`, `AlreadySubmitted`, `InvalidQuestion`, `InvalidChoice`,
`ChoiceNotAllowed`, `InvalidScore`, `InvalidProbability`, `InvalidHash`, `InvalidConfig(field)`,
`DuplicateState`, `QuorumUnavailable`, `InsufficientBond`, `ZeroAmount`, `ZeroAddress`,
`OperatorInUse`, `TooManyAgents`, `InvalidSettlement(reason)`, `TransferFailed`, `Unauthorized`.
Engine: `InvalidTransition`, `DeadlineNotReached`, `GuardianNotRequired`, `GuardianWindowClosed`,
`GuardianWindowOpen`, `InvalidChoice`, `ChoiceNotAllowed`, `NotApproved`.
Vault: `InvalidTransition`, `CooldownActive`, `IncorrectFee`, `InvalidPrice`, `ParamAboveCap`,
`InsufficientBalance`, `DirectTransferNotAllowed`. Outcome: `InvalidTransition`,
`HorizonNotReached`, `GraceNotElapsed`, `IncorrectFee`, `InvalidPrice`, `ExpoMismatch`, `ParamAboveCap`.
Role failures use OpenZeppelin's `AccessControlUnauthorizedAccount`.

## 13. Tests (Foundry) — `forge test`: 65 passing

| Area | File · contract |
|---|---|
| Valid lifecycle (ACTION_A correct with exact settlement numbers, NO_ACTION in band, fail-safe vs. move, cancel) | `Lifecycle.t.sol` · `LifecycleTest` |
| Invalid transitions, unknown decision, duplicate state, invalid config | `Lifecycle.t.sol` · `InvalidTransitionTest` |
| Duplicate / expired submissions, invalid choice / score / probability / question / hash, disallowed fork, non-participant | `Submissions.t.sol` · `SubmissionValidationTest` |
| Unauthorized access on every restricted function, locked bond, pause, direct transfers | `Submissions.t.sol` · `AccessControlTest` |
| Re-entrant withdrawal | `Submissions.t.sol` · `ReentrancyTest` |
| Threshold success (exactly at 60 %), threshold failure, score gate, tie-break, reputation weights, quorum failure, escalation + timeout | `Protocol.t.sol` · `AggregationTest` |
| Execution effects and caps, fee, stale / non-positive price, cooldown, emergency withdrawal | `Protocol.t.sol` · `ExecutionTest` |
| Outcome recording, horizon, publish-time window, expo mismatch, void | `Protocol.t.sol` · `OutcomeTest` |
| Settlement: missed penalty, no correct agent, preview == actual, fuzzed conservation | `Protocol.t.sol` · `SettlementTest` |
