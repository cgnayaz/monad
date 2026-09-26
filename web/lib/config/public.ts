/**
 * Public configuration. Only non-secret values may live here; everything in this
 * file can end up in the client bundle.
 */

export const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  rpcUrl: process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadexplorer.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
} as const;

/** Pyth — verified on Monad Testnet on 2026-09-26 (ARCHITECTURE.md §6). */
export const PYTH = {
  contract: "0x2880aB155794e7179c9eE2e38200202908C17B43",
  monUsdFeedId: "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1",
  feedSymbol: "MON/USD",
} as const;

export const REPO_URL = "https://github.com/cgnayaz/monad";
