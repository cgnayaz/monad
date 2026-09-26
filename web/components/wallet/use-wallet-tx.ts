"use client";

import { useCallback, useState } from "react";
import { formatEther, type Hex } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { monadTestnet } from "@/lib/chain/monad";
import { classifyTxError, type TxError } from "@/lib/chain/tx-errors";
import { prepareAction, type WalletAction } from "@/lib/chain/wallet-actions";
import { PYTH } from "@/lib/config/public";

/**
 * One transaction through its real lifecycle:
 *
 *   preparing → awaiting-approval → submitted → confirming → confirmed | failed
 *
 * Preparing builds the predefined call, fetches the signed oracle update if needed, simulates
 * it against the chain (so a revert is reported before the wallet opens) and checks that the
 * balance covers value + gas. After submission the receipt is read from the chain; only a
 * receipt with status "success" is reported as confirmed.
 */

export type TxPhase = "idle" | "preparing" | "awaiting-approval" | "submitted" | "confirming" | "confirmed" | "failed";

export interface TxReceiptView {
  hash: Hex;
  blockNumber: string;
  gasUsed: string;
  status: "success" | "reverted";
  from: Hex;
  to: Hex | null;
}

export interface TxState {
  phase: TxPhase;
  label: string | null;
  hash: Hex | null;
  receipt: TxReceiptView | null;
  error: TxError | null;
  note: string | null;
}

const IDLE: TxState = { phase: "idle", label: null, hash: null, receipt: null, error: null, note: null };

const pythFeeAbi = [
  { type: "function", name: "getUpdateFee", stateMutability: "view", inputs: [{ name: "u", type: "bytes[]" }], outputs: [{ name: "f", type: "uint256" }] },
] as const;

export function useWalletTx() {
  const [state, setState] = useState<TxState>(IDLE);
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const reset = useCallback(() => setState(IDLE), []);

  const run = useCallback(
    async (action: WalletAction, opts: { resolveAt?: number } = {}): Promise<TxReceiptView | null> => {
      const fail = (error: TxError, patch: Partial<TxState> = {}) => {
        setState((s) => ({ ...s, ...patch, phase: "failed", error }));
        return null;
      };
      let label: string | null = null;
      try {
        const call = prepareAction(action, opts.resolveAt);
        label = call.label;
        setState({ ...IDLE, phase: "preparing", label, note: "çağrı oluşturuluyor ve simüle ediliyor" });

        if (!isConnected || !address) return fail({ kind: "no-wallet", message: "Connect a wallet first.", detail: "not connected" });
        if (!publicClient) return fail({ kind: "rpc", message: "Monad RPC client unavailable.", detail: "no public client" });
        if (chainId !== monadTestnet.id) {
          setState((s) => ({ ...s, note: "cüzdan Monad Testnet'e geçiriliyor" }));
          await switchChainAsync({ chainId: monadTestnet.id });
        }

        let args = call.args;
        let value = 0n;
        if (call.priceUpdate) {
          setState((s) => ({ ...s, note: "imzalı Pyth fiyat güncellemesi alınıyor" }));
          const res = await fetch(`/api/oracle/update${call.priceUpdate.at ? `?at=${call.priceUpdate.at}` : ""}`, { cache: "no-store" });
          const body = (await res.json().catch(() => null)) as { data?: Hex[]; error?: string } | null;
          if (!res.ok || !body?.data) return fail({ kind: "rpc", message: `Oracle update unavailable: ${body?.error ?? res.status}`, detail: body?.error ?? String(res.status) });
          value = await publicClient.readContract({ address: PYTH.contract, abi: pythFeeAbi, functionName: "getUpdateFee", args: [body.data] });
          args = [...args, body.data];
        }

        setState((s) => ({ ...s, note: "güncel zincir durumuna karşı simüle ediliyor" }));
        await publicClient.simulateContract({ account: address, address: call.address, abi: call.abi, functionName: call.functionName, args, value });

        // Monad charges the gas limit, so the limit is the estimate plus a 10 % margin.
        const [estimate, gasPrice, balance] = await Promise.all([
          publicClient.estimateContractGas({ account: address, address: call.address, abi: call.abi, functionName: call.functionName, args, value }),
          publicClient.getGasPrice(),
          publicClient.getBalance({ address }),
        ]);
        const gas = (estimate * 11n) / 10n;
        const need = value + gas * gasPrice;
        if (balance < need) {
          return fail({
            kind: "insufficient-balance",
            message: `This needs about ${formatEther(need)} MON (fee + gas); the wallet holds ${formatEther(balance)} MON.`,
            detail: `need ${need} wei, have ${balance} wei`,
          });
        }

        setState((s) => ({ ...s, phase: "awaiting-approval", note: "işlemi cüzdanınızda onaylayın" }));
        const hash = await writeContractAsync({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args,
          value,
          gas,
          chainId: monadTestnet.id,
        });

        setState((s) => ({ ...s, phase: "submitted", hash, note: "Monad Testnet'e yayınlandı" }));
        setState((s) => ({ ...s, phase: "confirming", note: "makbuz bekleniyor" }));
        const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
        const receipt: TxReceiptView = {
          hash: r.transactionHash,
          blockNumber: r.blockNumber.toString(),
          gasUsed: r.gasUsed.toString(),
          status: r.status,
          from: r.from,
          to: r.to,
        };
        if (r.status !== "success") {
          return fail({ kind: "revert", message: `The transaction reverted in block ${r.blockNumber}.`, detail: hash }, { hash, receipt });
        }
        setState((s) => ({ ...s, phase: "confirmed", hash, receipt, note: null }));
        return receipt;
      } catch (err) {
        return fail(classifyTxError(err), { label });
      }
    },
    [address, chainId, isConnected, publicClient, switchChainAsync, writeContractAsync],
  );

  return { state, run, reset };
}
