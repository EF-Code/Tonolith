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

## Deploy the Fibonacci instance

The script deploys the immutable Fibonacci ROM, prints the initial code/data
state-init hashes, then ticks one instruction per transaction until HALT:

```sh
acton script scripts/deploy-fibonacci.tolk --net testnet --explorer tonviewer
```

The script prints `INIT`, `DEPLOY`, `STATE`, `STATE2`, and `FINAL` records.
Record the contract address, ROM root, static commitment, initial/final core
hashes, transaction links, gas used, forward fees, and storage balance from the
explorer. The expected Fibonacci commitments are in [ROM.md](ROM.md).

## Required independent checks

Use a second funded testnet wallet as the keeper where possible. For each
accepted tick, verify:

- the transaction is included and finalized;
- the sender is not required to be the deployer;
- `advanceCount` and `instructionCount` increase by one;
- `CpuAdvanced.previousStateHash` equals the submitted hash;
- the next hash agrees with the emulator/vector trace;
- output events contain `1, 1, 2, 3, 5, 8, 13`;
- the contract remains funded for storage and fees;
- a stale count/hash submission fails and leaves the state hash unchanged;
- a retry using the fresh count/hash succeeds;
- the final status is HALT and the final hash is recorded.

The current repository contains local Acton tests for these behaviors. A real
testnet explorer transaction is required before any of them can be called
testnet-proven.

## If deployment is blocked

Stop at the missing prerequisite. Report the exact missing wallet name,
testnet funding, provider/API credential, or user approval. Do not generate a
wallet, display a mnemonic, or place a secret in the repository just to pass a
deployment gate.
