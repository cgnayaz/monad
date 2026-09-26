import { defineChain } from "viem";
import { MONAD_TESTNET } from "@/lib/config/public";

export const monadTestnet = defineChain({
  id: MONAD_TESTNET.id,
  name: MONAD_TESTNET.name,
  nativeCurrency: MONAD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Monad Explorer", url: MONAD_TESTNET.explorerUrl } },
  testnet: true,
});

export const explorer = {
  tx: (hash: string) => `${MONAD_TESTNET.explorerUrl}/tx/${hash}`,
  address: (addr: string) => `${MONAD_TESTNET.explorerUrl}/address/${addr}`,
  block: (n: bigint | number) => `${MONAD_TESTNET.explorerUrl}/block/${n.toString()}`,
};
