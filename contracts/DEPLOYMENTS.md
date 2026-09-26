# Deployments

## Monad Testnet (chain 10143) — 2026-09-26

| Contract | Address | Source |
|---|---|---|
| DecisionRegistry | [`0x5Bb0b4Ae439e34c90a877237DB584FCEEBA37894`](https://testnet.monadexplorer.com/address/0x5Bb0b4Ae439e34c90a877237DB584FCEEBA37894) | Sourcify exact match |
| DecisionEngine | [`0x56c3CD72df8667Db4486b5268DE5d4CDCf17c284`](https://testnet.monadexplorer.com/address/0x56c3CD72df8667Db4486b5268DE5d4CDCf17c284) | Sourcify exact match |
| ExecutionVault | [`0xd1E4768905AaA8B473617b0eF625C0acbfD59C1a`](https://testnet.monadexplorer.com/address/0xd1E4768905AaA8B473617b0eF625C0acbfD59C1a) | Sourcify exact match |
| OutcomeRegistry | [`0xfd9bbcaAd1334dD4363aaa973d7Fe2075dc53B0D`](https://testnet.monadexplorer.com/address/0xfd9bbcaAd1334dD4363aaa973d7Fe2075dc53B0D) | Sourcify exact match |

- First deployment block: 65832355 (19 transactions, all successful).
- Pyth: `0x2880aB155794e7179c9eE2e38200202908C17B43`, feed MON/USD.
- Deployer (initial admin): `0x11aE2ee695a2FC107d38f6Fe63608ecF1dc50b0D`.
- Operator wallet `0xbAB6645D0843ddB00Aa1CCfdf369F48F8b620B97`: `DEFAULT_ADMIN_ROLE` on all four contracts and `GUARDIAN_ROLE` on DecisionEngine.
- Proposer `0x7e71949338cA8Af840ca84A0EEE95dE86a5ef046`, keeper `0xb34D302FcF1d6FE47519FC90EF3b10E3188d043c`.

| Agent id | Agent | Operator |
|---|---|---|
| 0 | Risk Analyst | `0x74AaaB6ee11F0cc9D25a517CF3d96075ba5b6393` |
| 1 | Yield Analyst | `0x3643A20CD8e2Ceb185Fc0bDB0D4155F36F82a4Cf` |
| 2 | Security Analyst | `0x85a4308Fda98B4E38eCF8a052bb25eaA62fBd69b` |
| 3 | Market Analyst | `0x960ba575158C3600b35dDc7c2EE60963058cad63` |
| 4 | Historical Analyst | `0x2469FBfd3359057be54c05d0bC606E5bCc7fD4aA` |

Initial funding (Setup): vault 1 MON RESERVE + 1 MON ACTIVE, reward pool 0.5 MON, round
reward 0.02 MON, 0.5 MON bond per agent, gas for operators, proposer and keeper.
Live values are always read from chain on `/contracts` and `/agents`.

Verify: `forge verify-contract <address> <path>:<Name> --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org --constructor-args …`
