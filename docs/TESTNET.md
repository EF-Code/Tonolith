# Testnet deployment and verification runbook

Tonolith is testnet-only in v1. Never pass a mainnet network selector to these
scripts.

## Prerequisites

1. Use Acton 1.0.0 with the repository toolchain.
2. Configure a wallet named `tonolith-testnet` in Acton’s wallet store.
3. Fund that wallet from a TON testnet faucet and confirm the balance is large
   enough for deployment plus 97 one-step advances.
4. Keep wallet stores, mnemonics, private keys, provider credentials, and API
   keys outside Git. The repository ignores local wallet and mnemonic files.

Check the boundary without creating or exporting secrets:

```sh
acton wallet list
acton doctor
```

