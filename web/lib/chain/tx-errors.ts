import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  RpcRequestError,
  TimeoutError,
  UserRejectedRequestError,
} from "viem";

/**
 * Classify wallet / RPC / contract failures into what the user needs to know.
 * The raw message is kept in `detail`; nothing is swallowed.
 */
export type TxErrorKind =
  | "no-wallet"
  | "rejected"
  | "wrong-network"
  | "insufficient-balance"
  | "rpc"
  | "revert"
  | "unknown";

export interface TxError {
  kind: TxErrorKind;
  message: string;
  detail: string;
  /** Custom error name decoded from the contract ABI, e.g. "DeadlinePassed". */
  revertName?: string;
}

const firstLine = (s: string) => s.split("\n")[0];

export function classifyTxError(err: unknown): TxError {
  const detail = err instanceof Error ? firstLine(err.message) : String(err);
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted) {
      const name = reverted.data?.errorName;
      const args = reverted.data?.args?.length ? `(${reverted.data.args.map(String).join(", ")})` : "";
      return {
        kind: "revert",
        message: name ? `The contract rejected the call: ${name}${args}` : `The contract reverted${reverted.reason ? `: ${reverted.reason}` : ""}`,
        detail,
        revertName: name,
      };
    }
    if (err.walk((e) => e instanceof UserRejectedRequestError) || /user rejected|user denied|rejected the request/i.test(detail)) {
      return { kind: "rejected", message: "The request was rejected in the wallet.", detail };
    }
    if (err.walk((e) => e instanceof InsufficientFundsError) || /insufficient funds/i.test(detail)) {
      return { kind: "insufficient-balance", message: "The wallet does not hold enough MON for this transaction and its gas.", detail };
    }
    if (err.walk((e) => e instanceof ChainMismatchError)) {
      return { kind: "wrong-network", message: "The wallet is connected to a different network. Switch to Monad Testnet.", detail };
    }
    if (err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError || e instanceof RpcRequestError)) {
      return { kind: "rpc", message: "The Monad RPC did not respond correctly. Try again.", detail };
    }
  }
  if (/connector not (found|connected)|provider not found|no injected/i.test(detail)) {
    return { kind: "no-wallet", message: "No browser wallet was found. Install or unlock MetaMask.", detail };
  }
  if (/4001|user rejected/i.test(detail)) return { kind: "rejected", message: "The request was rejected in the wallet.", detail };
  return { kind: "unknown", message: detail || "Unknown error", detail };
}
