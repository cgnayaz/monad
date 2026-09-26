# Deployments

## Monad Testnet (chain 10143) — 2026-09-26, current (post security audit)

| Contract | Address | Source |
|---|---|---|
| DecisionRegistry | [`0x86d7E507F9eBfda17c5265804996b71028b05D10`](https://testnet.monadexplorer.com/address/0x86d7E507F9eBfda17c5265804996b71028b05D10) | Sourcify exact match |
| DecisionEngine | [`0x2F4773B8d8cF125Fc0fCbd1973834065f3CA40b3`](https://testnet.monadexplorer.com/address/0x2F4773B8d8cF125Fc0fCbd1973834065f3CA40b3) | Sourcify exact match |
| ExecutionVault | [`0x65355f7f037b84E14Bc2147700Bb6b3F29B56276`](https://testnet.monadexplorer.com/address/0x65355f7f037b84E14Bc2147700Bb6b3F29B56276) | Sourcify exact match |
| OutcomeRegistry | [`0x97ec926D45115caB5D56aF2A8d373c78D80cFa47`](https://testnet.monadexplorer.com/address/0x97ec926D45115caB5D56aF2A8d373c78D80cFa47) | Sourcify exact match |

- First deployment block: 65839318.
- Pyth: `0x2880aB155794e7179c9eE2e38200202908C17B43`, reference feed **ETH/USD**
  `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` (the Hermes key is not
  entitled to MON/USD). Resolution uses `parsePriceFeedUpdatesUnique`; start price max age 10 s;
  void grace 1 h; lock cap 1 MON per agent.
- Deployer: `0x11aE2ee695a2FC107d38f6Fe63608ecF1dc50b0D`.
- Operator wallet `0xbAB6645D0843ddB00Aa1CCfdf369F48F8b620B97`: `DEFAULT_ADMIN_ROLE` on all four contracts and `GUARDIAN_ROLE` on DecisionEngine.
- Proposer `0x7e71949338cA8Af840ca84A0EEE95dE86a5ef046`, keeper `0xb34D302FcF1d6FE47519FC90EF3b10E3188d043c`.

| Agent id | Agent | Operator |
|---|---|---|
| 0 | Risk Analyst | `0x74AaaB6ee11F0cc9D25a517CF3d96075ba5b6393` |
| 1 | Yield Analyst | `0x3643A20CD8e2Ceb185Fc0bDB0D4155F36F82a4Cf` |
| 2 | Security Analyst | `0x85a4308Fda98B4E38eCF8a052bb25eaA62fBd69b` |
| 3 | Market Analyst | `0x960ba575158C3600b35dDc7c2EE60963058cad63` |
| 4 | Historical Analyst | `0x2469FBfd3359057be54c05d0bC606E5bCc7fD4aA` |

Funding (Setup, idempotent): vault 0.5 MON RESERVE + 0.5 MON ACTIVE, reward pool 0.3 MON,
0.5 MON bond per agent, gas for operators, proposer and keeper. Live values are always read
from chain on `/contracts` and `/agents`.

Fork check against this deployment and the real Pyth contract: `web/scripts/fork-pyth.sh`.

## Retired deployment (pre-audit)

Registry `0x5Bb0b4Ae439e34c90a877237DB584FCEEBA37894`, engine `0x56c3CD72df8667Db4486b5268DE5d4CDCf17c284`,
vault `0xd1E4768905AaA8B473617b0eF625C0acbfD59C1a`, outcome `0xfd9bbcaAd1334dD4363aaa973d7Fe2075dc53B0D`
(block 65832355, MON/USD feed). Retired because of audit finding H-1: all contracts paused, the
vault treasury withdrawn with `emergencyWithdraw`, agent bonds withdrawn. 0.5 MON remains in
that registry's reward pool — the old contract had no withdrawal path (finding L-2).

Verify: `forge verify-contract <address> <path>:<Name> --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org --constructor-args …`
