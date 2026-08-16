# Testnet deployment and verification runbook

Tonolith is testnet-only in v1. Never pass a mainnet network selector to these
scripts.

## Recorded Fibonacci run

The v1 Fibonacci instance has completed on TON testnet. This is the current
public run record:

- Contract: [`kQDC...a1av`](https://testnet.tonviewer.com/kQDCENlXgMC1FOWvEtM2wKcJHBLKS86Tbkv9xkT0u5aIa1av)
- Transactions: 98 total — 1 deployment and 97 accepted `Advance` messages;
- Execution: one instruction per transaction, final PC 21, HALT after 97
  instructions;
- Outputs: `1, 1, 2, 3, 5, 8, 13`;
- Final core state hash:
  `16925a27b1db66171cebb3d43c74702f06f4a362e302754f24026cca0a6bf2be`;
- State-init hash:
  `c210d95780c0b514e5af12d336c0a7091c12ca4bce936e4bfdc644f4bb96886b`;
- Code hash:
  `dafd53a42bfb14d9de792a4ae9fda1e990c27abe356a38791911bf0a3d8bc7d5`;
- Initial data hash:
  `cd82de624829d70573a46eb33c3379650dbe98af38730289a1cda2fa9a990bed`;
- ROM root:
  `029ccf15774f680518705bb7c8be4b2ca92f34a4ceb9c963e55609225398c748`;
- Static commitment:
  `50da71fe389768e885c8258c7f4f4a97b86598738eed974336d527e459024f08`.

[Deployment transaction](https://testnet.tonviewer.com/transaction/5a8c2ef9ff188f76ddd68f2b9700a5266aaac9c74bf35f4b797746d69f1daca7)

The run is also available in the [Tonolith Visualizer](https://github.com/EF-Code/tonolith-visualizer)
for transaction-by-transaction inspection.

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

The recorded run above establishes the public Fibonacci execution path. Use
this checklist when reproducing the run or expanding the public evidence with
additional keepers and failure-path transactions.

## If deployment is blocked

Stop at the missing prerequisite. Report the exact missing wallet name,
testnet funding, provider/API credential, or user approval. Do not generate a
wallet, display a mnemonic, or place a secret in the repository just to pass a
deployment gate.
