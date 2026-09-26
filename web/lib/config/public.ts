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

/**
 * Pyth — contract verified on Monad Testnet on 2026-09-26 (ARCHITECTURE.md §6).
 * Reference feed: ETH/USD. MON/USD exists on Pyth but is not included in the configured
 * Hermes plan ("not entitled"), so the outcome reference is ETH/USD. The feed is fixed in
 * ExecutionVault and OutcomeRegistry at deployment; this constant must match it.
 */
export const PYTH = {
  contract: "0x2880aB155794e7179c9eE2e38200202908C17B43",
  feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  feedSymbol: "ETH/USD",
} as const;

export const REPO_URL = "https://github.com/cgnayaz/monad";
