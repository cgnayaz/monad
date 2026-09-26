# Demo Flow

The judge-facing demo is `/demo`: one round of the real system, told as eleven steps on
one page. Target: about two minutes of narration plus the 60 s horizon.

## Modes

| | Simulation mode | Live testnet mode |
|---|---|---|
| Needs | an AI provider key (`GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`) (+ `PYTH_API_KEY` for verify) | the above + deployed contracts + proposer, keeper and 5 agent keys |
| State, questions, agents, aggregation | real, identical | real, identical; state hash committed on-chain **before** agents run |
| Action | applied to a local model of the vault; no funds, no transaction | `ExecutionVault.execute` approved in the judge's wallet (or by the keeper) |
| Monad step | explicitly shows "no transactions" | every transaction with pending → confirmed state and explorer links |
| Verify | real Pyth price observed after the horizon; labelled not on-chain | `OutcomeRegistry.resolve` with a signed price inside the window |
| Settlement | contract formula on notional bonds; labelled | read from chain after the resolve transaction |

A striped **SIMULATION** banner or an accent **LIVE · MONAD TESTNET** banner is always
visible once a round starts. Simulation never shows a transaction hash, block or balance.

Demo time scale: 90 s submission window, 60 s horizon (`DEMO_PARAMETERS`). Same rules.

## The eleven steps

| # | Step | What the judge sees | Source |
|---|---|---|---|
| 1 | State | state id, hash, sources, inputs (available / unavailable with reason) | collectors |
| 2 | Questions | six questions with their own ids and the inputs they evaluate | `buildQuestionSet` |
| 3 | Parallel decisions | five lanes on one time axis; all start together; failures labelled | pipeline stream |
| 4 | Choice · Score · Probability · Reason | per agent, with bond (live) | agent runs |
| 5 | Batch / question results | question × agent matrix; the Q0 row feeds aggregation | agent batches |
| 6 | Bounded forks | NO_ACTION · ACTION_A (DERISK) · ACTION_B (DEPLOY) · ESCALATE, allowed flags, vote counts | `ACTION_SPACE` |
| 7 | Aggregation | aggregate score, aggregate probability, selected choice, threshold + gates | deterministic rules / DecisionEngine |
| 8 | Action | the approved predefined action, or NO_ACTION as fail-safe | `resolveAction` / engine |
| 9 | Monad | createDecision, openDecision, 5 × submitBatch, aggregate, execute (wallet) | chain |
| 10 | Verify | countdown to the horizon, then expected vs observed, price move vs band | Pyth / OutcomeRegistry |
| 11 | Settlement | agent, prediction, result, bond, reward, penalty, net | contract formula / chain |

## Script (live mode)

| Time | Step | Say |
|---|---|---|
| 0:00 | header | "Jev structures the decision; DecMarkt makes it accountable; Monad enforces it." |
| 0:10 | 1–2 | "This is the real state right now, hashed. These are the questions it generates. The hash is on-chain before any agent runs." |
| 0:25 | 3–4 | "Five analysts start at once. Each returns a choice from a closed set, a score computed from its rubric, a probability and a reason. Here one failed — it is shown, not hidden." |
| 0:50 | 5–6 | "Every question-level answer is its own record; only the action question is aggregated. This is the whole action space." |
| 1:05 | 7–8 | "No model picks the result. Probability times track record, sixty percent threshold, minimum score. Passed — so the vault may run exactly this branch." |
| 1:20 | 9 | "I approve the execution in my wallet. The contract decides what runs; my wallet only pays the oracle fee." |
| 1:30 | 10 | "After the horizon the signed Pyth price decides which action was correct." |
| 2:30 | 11 | "Bonds settle by fixed rules: right agents earn, wrong ones lose in proportion to their confidence, the missing one pays a penalty." |

Then open the decision's audit record (link in the round summary).

## Failure handling

Any failing step stops the lifecycle: the step is marked failed with the actual error,
later steps are marked stopped, and **Retry** re-runs from the right place (execution and
verification retry in place; earlier failures restart the round). No success is shown for
a step that did not complete.

| Failure | What happens |
|---|---|
| AI key / oracle key / contracts missing | the mode is unavailable, with the reason, before starting |
| An agent times out or returns invalid output | labelled on its lane; counted as missed; the round continues |
| Quorum not met | live: aggregation after the deadline cancels the decision (bonds returned) — shown as failed with the reason |
| Wallet rejects the transaction | step 9 fails with the wallet's message; retry or use the keeper |
| Oracle unavailable at verify | step 10 fails with the error; retry |
| Rate limit | "retry in N s" |

## Before presenting

- [ ] Keys configured on the deployment; `/demo` shows both modes available.
- [ ] Judge wallet on Monad Testnet with a little MON for gas + Pyth fee.
- [ ] One full live round run earlier (it appears on the dashboard and in `/decisions`).
- [ ] Backup: a recording of a full live round, labelled as a recording.
