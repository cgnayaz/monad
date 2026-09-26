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
        message: name ? `Kontrat çağrıyı reddetti: ${name}${args}` : `Kontrat revert etti${reverted.reason ? `: ${reverted.reason}` : ""}`,
        detail,
        revertName: name,
      };
    }
    if (err.walk((e) => e instanceof UserRejectedRequestError) || /user rejected|user denied|rejected the request/i.test(detail)) {
      return { kind: "rejected", message: "İstek cüzdanda reddedildi.", detail };
    }
    if (err.walk((e) => e instanceof InsufficientFundsError) || /insufficient funds/i.test(detail)) {
      return { kind: "insufficient-balance", message: "Cüzdanda bu işlem ve gas için yeterli MON yok.", detail };
    }
    if (err.walk((e) => e instanceof ChainMismatchError)) {
      return { kind: "wrong-network", message: "Cüzdan farklı bir ağa bağlı. Monad Testnet'e geçin.", detail };
    }
    if (err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError || e instanceof RpcRequestError)) {
      return { kind: "rpc", message: "Monad RPC doğru yanıt vermedi. Tekrar deneyin.", detail };
    }
  }
  if (/connector not (found|connected)|provider not found|no injected/i.test(detail)) {
    return { kind: "no-wallet", message: "Tarayıcı cüzdanı bulunamadı. MetaMask'ı kurun veya kilidini açın.", detail };
  }
  if (/4001|user rejected/i.test(detail)) return { kind: "rejected", message: "İstek cüzdanda reddedildi.", detail };
  return { kind: "unknown", message: detail || "Bilinmeyen hata", detail };
}
