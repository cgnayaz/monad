import type { AgentKey, QuestionKey } from "@/lib/types/protocol";

/**
 * The five logical decision makers used for Jev Parallel Decisions (JEV_INTEGRATION.md §7).
 *
 * This is role configuration, not performance data. Each agent's on-chain identity
 * (operator address, bond, accuracy) is owned by DecisionRegistry and read from chain.
 */

export interface AgentSpec {
  key: AgentKey;
  /** Registration order in DecisionRegistry.registerAgent (agentId). */
  agentId: number;
  name: string;
  primaryQuestion: QuestionKey;
  mandate: string;
  /** Server env var holding this agent's operator key. The model never sees it. */
  operatorKeyEnv: `AGENT_${AgentKey}_PRIVATE_KEY`;
}

export const AGENTS: readonly AgentSpec[] = [
  {
    key: "RISK",
    agentId: 0,
    name: "Risk Analyst",
    primaryQuestion: "RISK",
    mandate:
      "Protect the vault's MON value. Weigh downside magnitude and volatility against the band; prefer the fork that minimises loss when evidence is mixed.",
    operatorKeyEnv: "AGENT_RISK_PRIVATE_KEY",
  },
  {
    key: "YIELD",
    agentId: 1,
    name: "Yield Analyst",
    primaryQuestion: "YIELD",
    mandate:
      "Identify opportunity. Judge whether increasing deployed funds is justified by the expected favourable move relative to the band.",
    operatorKeyEnv: "AGENT_YIELD_PRIVATE_KEY",
  },
  {
    key: "SECURITY",
    agentId: 2,
    name: "Security Analyst",
    primaryQuestion: "SECURITY",
    mandate:
      "Assess whether the inputs and infrastructure are trustworthy enough to act on: oracle freshness and confidence, network health, protocol state.",
    operatorKeyEnv: "AGENT_SECURITY_PRIVATE_KEY",
  },
  {
    key: "MARKET",
    agentId: 3,
    name: "Market Analyst",
    primaryQuestion: "MARKET",
    mandate:
      "Read the current market: spot versus moving average, short-term change, and whether the signal clears the noise implied by confidence and band.",
    operatorKeyEnv: "AGENT_MARKET_PRIVATE_KEY",
  },
  {
    key: "HISTORY",
    agentId: 4,
    name: "Historical Analyst",
    primaryQuestion: "HISTORY",
    mandate:
      "Use history: past price behaviour over comparable windows and the correct forks of previously resolved decisions. Be explicit when history is thin.",
    operatorKeyEnv: "AGENT_HISTORY_PRIVATE_KEY",
  },
];

export function agentByKey(key: AgentKey): AgentSpec {
  const a = AGENTS.find((x) => x.key === key);
  if (!a) throw new Error(`Unknown agent ${key}`);
  return a;
}
