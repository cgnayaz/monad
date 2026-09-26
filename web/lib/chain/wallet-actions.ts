import type { Abi } from "viem";
import { decisionEngineAbi, executionVaultAbi, outcomeRegistryAbi } from "./abis";
import { contractAddress, type ContractName } from "./deployments";
import type { Address } from "@/lib/types/protocol";

/**
 * The complete set of transactions a browser wallet can send through DecMarkt. Each maps
 * to one fixed contract function; arguments are a decision id (and, for a guardian, one of
 * three bounded choices). No action accepts an address, an amount or calldata from the
 * UI, and the AI layer never reaches this module.
 *
 *   aggregate            DecisionEngine.aggregate(id)             anyone, after the deadline
 *   guardianDecide       DecisionEngine.guardianDecide(id, c)     GUARDIAN_ROLE, on escalation
 *   finalizeEscalation   DecisionEngine.finalizeEscalation(id)    anyone, after the guardian window
 *   execute              ExecutionVault.execute(id, pythUpdate)   anyone, once APPROVED (pays the Pyth fee)
 *   resolve              OutcomeRegistry.resolve(id, pythUpdate)  anyone, after the horizon (pays the Pyth fee)
 */
export type WalletAction =
  | { kind: "aggregate"; decisionId: string }
  | { kind: "guardianDecide"; decisionId: string; choice: 0 | 1 | 2 }
  | { kind: "finalizeEscalation"; decisionId: string }
  | { kind: "execute"; decisionId: string }
  | { kind: "resolve"; decisionId: string };

export interface PreparedCall {
  label: string;
  contract: ContractName;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** The signed Pyth update the call needs, and when it must be published (unix s); null = latest. */
  priceUpdate: { at: number | null } | null;
}

export const ACTION_LABEL: Record<WalletAction["kind"], string> = {
  aggregate: "DecisionEngine.aggregate",
  guardianDecide: "DecisionEngine.guardianDecide",
  finalizeEscalation: "DecisionEngine.finalizeEscalation",
  execute: "ExecutionVault.execute",
  resolve: "OutcomeRegistry.resolve",
};

/**
 * Build the call for a predefined action. `resolveAt` is the chain-derived publish time
 * (executedAt + horizon + 1) required by OutcomeRegistry; it is never user input.
 */
export function prepareAction(action: WalletAction, resolveAt?: number): PreparedCall {
  const id = BigInt(action.decisionId);
  if (id < 1n) throw new Error("Invalid decision id");
  const addr = (name: ContractName) => {
    const a = contractAddress(name);
    if (!a) throw new Error(`${name} is not deployed`);
    return a;
  };
  switch (action.kind) {
    case "aggregate":
      return { label: ACTION_LABEL.aggregate, contract: "DecisionEngine", address: addr("DecisionEngine"), abi: decisionEngineAbi, functionName: "aggregate", args: [id], priceUpdate: null };
    case "guardianDecide":
      if (![0, 1, 2].includes(action.choice)) throw new Error("Guardian may choose NO_ACTION, ACTION_A or ACTION_B only");
      return { label: ACTION_LABEL.guardianDecide, contract: "DecisionEngine", address: addr("DecisionEngine"), abi: decisionEngineAbi, functionName: "guardianDecide", args: [id, action.choice], priceUpdate: null };
    case "finalizeEscalation":
      return { label: ACTION_LABEL.finalizeEscalation, contract: "DecisionEngine", address: addr("DecisionEngine"), abi: decisionEngineAbi, functionName: "finalizeEscalation", args: [id], priceUpdate: null };
    case "execute":
      return { label: ACTION_LABEL.execute, contract: "ExecutionVault", address: addr("ExecutionVault"), abi: executionVaultAbi, functionName: "execute", args: [id], priceUpdate: { at: null } };
    case "resolve":
      if (!resolveAt) throw new Error("Resolution time unknown");
      return { label: ACTION_LABEL.resolve, contract: "OutcomeRegistry", address: addr("OutcomeRegistry"), abi: outcomeRegistryAbi, functionName: "resolve", args: [id], priceUpdate: { at: resolveAt } };
  }
}
