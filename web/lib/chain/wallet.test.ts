import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError, HttpRequestError, InsufficientFundsError, UserRejectedRequestError } from "viem";
import { decisionRegistryAbi } from "./abis";
import { classifyTxError } from "./tx-errors";
import { ACTION_LABEL, prepareAction } from "./wallet-actions";

describe("classifyTxError", () => {
  it("recognises a wallet rejection", () => {
    expect(classifyTxError(new UserRejectedRequestError(new Error("User denied transaction signature"))).kind).toBe("rejected");
  });
  it("recognises insufficient funds and RPC failures", () => {
    expect(classifyTxError(new InsufficientFundsError({ cause: new BaseError("insufficient funds for gas * price + value") })).kind).toBe("insufficient-balance");
    expect(classifyTxError(new HttpRequestError({ url: "https://testnet-rpc.monad.xyz", status: 502 })).kind).toBe("rpc");
  });
  it("decodes a custom-error revert by name", () => {
    const data = "0x9d1d2ab8" as const; // not a registry selector → still a revert without a name
    const revert = new ContractFunctionRevertedError({ abi: decisionRegistryAbi, functionName: "submit", data });
    const e = classifyTxError(revert);
    expect(e.kind).toBe("revert");
  });
  it("reports a missing wallet", () => {
    expect(classifyTxError(new Error("Provider not found.")).kind).toBe("no-wallet");
  });
});

describe("predefined wallet actions", () => {
  it("only builds calls to the five fixed functions", () => {
    expect(Object.values(ACTION_LABEL)).toEqual([
      "DecisionEngine.aggregate",
      "DecisionEngine.guardianDecide",
      "DecisionEngine.finalizeEscalation",
      "ExecutionVault.execute",
      "OutcomeRegistry.resolve",
    ]);
  });
  it("refuses to build calls while the contracts are not deployed", () => {
    expect(() => prepareAction({ kind: "aggregate", decisionId: "1" })).toThrow(/not deployed/);
  });
  it("rejects an invalid decision id and a guardian choice outside the bounded set", () => {
    expect(() => prepareAction({ kind: "execute", decisionId: "0" })).toThrow(/Invalid decision id/);
    expect(() => prepareAction({ kind: "guardianDecide", decisionId: "1", choice: 3 as unknown as 0 })).toThrow();
  });
});
