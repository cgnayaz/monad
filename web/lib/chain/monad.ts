import { defineChain } from "viem";
import { MONAD_TESTNET } from "@/lib/config/public";

/** Multicall3 is deployed on Monad Testnet; a local anvil chain (scripts/local-chain.sh) has none. */
export const isLocalRpc = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(MONAD_TESTNET.rpcUrl);

export const monadTestnet = defineChain({
  id: MONAD_TESTNET.id,
  name: MONAD_TESTNET.name,
  nativeCurrency: MONAD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Monad Explorer", url: MONAD_TESTNET.explorerUrl } },
  contracts: isLocalRpc ? undefined : { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 251449 } },
  testnet: true,
});

export const explorer = {
  tx: (hash: string) => `${MONAD_TESTNET.explorerUrl}/tx/${hash}`,
  address: (addr: string) => `${MONAD_TESTNET.explorerUrl}/address/${addr}`,
  block: (n: bigint | number) => `${MONAD_TESTNET.explorerUrl}/block/${n.toString()}`,
};
