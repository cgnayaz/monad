# Demo Flow

Target: 3 minutes on stage, fully live on Monad Testnet. Every value shown is real.

## 0. Before judges arrive (checklist)

- [ ] Contracts deployed, roles wired, parameters set (DEPLOYMENT.md).
- [ ] 5 agents registered and bonded; reward pool funded; vault funded.
- [ ] Proposer, agent and keeper keys have gas.
- [ ] At least one **fully resolved** decision exists from earlier today (real, on-chain)
      — used to show settlement if the live round's horizon has not elapsed yet.
- [ ] `/demo` loads, network indicator shows current block, AI provider health = ok.
- [ ] Guardian wallet connected in a second tab (for an ESCALATE case).
- [ ] Backup: screen recording of a full real round (clearly labelled "recording").

## 1. Script

| Time | Screen | Action | Say |
|---|---|---|---|
| 0:00 | `/` | — | "AI agents make decisions nobody is accountable for. DecMarkt makes every AI decision bonded, bounded and settled on Monad." |
| 0:15 | `/demo` | **Start round** | "The server snapshots real state: Pyth MON/USD, Monad network data, vault balances. It is hashed and committed on-chain before any agent runs." → CREATED + OPEN tx links appear |
| 0:35 | State + Questions | scroll | "These are the exact inputs and the six explicit questions. Nothing is hidden in a prompt." |
| 0:50 | Decision matrix | agents land one by one | "Five independent analysts, each with its own operator address and bond. Each gives a choice from four bounded forks, a deterministic score, a probability, and a reason. Each is its own transaction." |
| 1:20 | Support bars + verdict | **Aggregate** | "Aggregation is not an LLM. It's integer math in DecisionEngine: probability × track record. 60% threshold, quorum 4, minimum score for action." → AGGREGATED + APPROVED |
| 1:45 | Action record | **Execute** | "Only the approved fork can run. The vault moves MON between buckets — no external calls, no AI calldata. Start price is verified from Pyth on-chain." → EXECUTED |
| 2:05 | `/decisions/[earlier id]` | open | "The horizon is 3 minutes, so here's this morning's round. The end price is a signed Pyth update inside a strict time window. Correct fork: DERISK." |
| 2:25 | Settlement table | — | "Correct agents get their bond back plus rewards, weighted by probability. Wrong agents are slashed in proportion to their confidence. The agents had no say in this." |
| 2:40 | Integrity panel | — | "Every off-chain payload is re-hashed in your browser against the chain. Green means it matches." |
| 2:50 | `/agents` | — | "Over time, accuracy on-chain becomes voting weight. That's accountability. Built on Monad." |

Return to the live round at the end if its horizon has elapsed → **Resolve** live.

## 2. Failure handling on stage

| Failure | What the UI shows | What to do |
|---|---|---|
| AI provider slow/failing | agent row: `unavailable — provider timeout` | continue; quorum 4 of 5 tolerates one |
| Quorum not met | CANCELLED with reason | say "fail-safe", open the resolved earlier decision |
| RPC hiccup | pending line + retry | the step endpoint is idempotent; press again |
| Threshold not met | APPROVED → NO_ACTION with verdict | explain fail-safe: disagreement never moves funds |
| ESCALATE wins | guardian panel | sign guardian choice from second tab |
| Everything down | recording | say it is a recording |

## 3. What judges can do themselves

- Open any tx on the Monad explorer from any step.
- Click any hash to see the recomputed value.
- Read `/contracts` for addresses and roles; `/how-it-works` for the protocol.
