# Tonolith v2 testnet validation

This is a testnet-only runbook. It is intentionally a blank evidence record
until a release candidate has passed all local gates. The existing v1 run in
[`../TESTNET.md`](../TESTNET.md) is separate evidence and must not be reused as
v2 proof.

## Release boundary

Do not run the deployment script while any local release gate is open. The v2
candidate must first pass formatting, checking, compilation, all Acton and
TypeScript tests, reproducibility, coverage, mutation, and the gas/action/
storage/message-size checks. Mainnet is out of scope.

The current status is **not deployed**. The local Acton coverage and mutation
gates are open, and this record contains no fabricated address or transaction.

## Preflight

```sh
acton wallet list
acton doctor
acton fmt --check
acton check
acton build
acton test --fuzz-seed 42
npm run typecheck
npm test
```

The deployment wallet is selected by the script as
`tonolith-testnet`. A second independently funded keeper should be available
as `tonolith-keeper-b`. Wallet files, mnemonics, signed messages, provider
credentials, and API keys stay outside the repository and are never printed.

## Single-core Fibonacci deployment

After the local release record is green, run exactly the testnet selector:

```sh
acton script scripts/deploy-v2-fibonacci.tolk --net testnet --explorer tonviewer
```

Capture the script output and explorer data without committing secrets. The
deployment record must contain:

```text
network: testnet
address: <raw address>
deployment transaction: <transaction link>
deployment lt / masterchain reference: <values>
code hash: <hash>
initial data hash: <hash>
StateInit hash: <hash>
program id: e140cb991c86e81663dbe688da3e6a2b18d14b260b0aca0a0c7b1381707a7dda
ROM root: 029ccf15774f680518705bb7c8be4b2ca92f34a4ceb9c963e55609225398c748
RAM root: ed807133df392920f6ed73d30ab7e67ecaee528d940e1be1ea8e44cd25031b8e
route root: 9e548d24c3c980ff9fe617f92286289613d6deae0b0da0cbe88aa8a51e6d9bcb
limits hash: f8d3ee4ee34e55e437aa1decfa2742d81aa6d623beec67c9394d736376beb1fb
static commitment: 2c5978dc7ca91a1899cd345f5e9232500f50670ac7612fddb30f64eb879677f9
initial state hash: <hash>
final state hash: <hash>
```

The immutable commitments above are the canonical Fibonacci artifact values;
the address and StateInit hashes still depend on the compiled contract code
and the complete network cell. Verify them from the actual StateInit BOC.

## Transaction and keeper checks

For the deployment and each accepted one-step `Advance`:

1. confirm RPC submission, inclusion, and masterchain-referenced finality as
   separate observations;
2. record gas used, computation/action/forward/storage fees, balance, and
   reserve behavior;
3. verify `advanceCount`, `instructionCount`, PC, output event, previous-state
   hash, next-state hash, and the next expected message;
4. submit one tick from `tonolith-keeper-b` rather than the deployer;
5. deliberately submit a stale count/hash from the other keeper and verify
   rejection with no architectural state change;
6. retry with the fresh count/hash and verify exactly one accepted mutation;
7. replay the accepted history with the independent verifier using two
   independent chain data sources;
8. export a trace accepted by the visualizer and label it `testnet`, never
   `local-emulator`.

The expected output sequence is `1, 1, 2, 3, 5, 8, 13`. A testnet claim is
incomplete unless the output events, final state hash, actual fees, and finality
are all recorded.

## Multi-core boundary

The TypeScript emulator proves authenticated routing, duplicate delivery,
acknowledgement, retry, backpressure, counter-pipeline, and two-core carry
vectors locally. A production multi-core testnet deployment additionally needs
a non-circular address/StateInit manifest for every peer. The current immutable
peer table binds exact peer addresses into each core's static data, so two cores
that derive each other's addresses cannot be deployed by independently guessing
those addresses. Until a reviewed address-manifest scheme or factory is added,
multi-core deployment remains an unresolved engineering gate and must not be
described as testnet-proven.

## Evidence ledger

| Evidence | Status | Record |
| --- | --- | --- |
| v2 code/data/StateInit commitments | pending | — |
| real deployment inclusion/finality | pending | — |
| single-step Fibonacci outputs | pending | — |
| actual gas and fees | pending | — |
| second keeper accepted tick | pending | — |
| stale/racing keeper rejection | pending | — |
| duplicate delivery and acknowledgement | pending | — |
| bounce/retry and backpressure recovery | pending | — |
| independent verifier replay | pending | — |
| visualizer-compatible verified trace | pending | — |
| two-core pipeline deployment | blocked by address manifest | — |
