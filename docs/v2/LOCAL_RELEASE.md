# Tonolith v2 local release record

This record separates reproducible local evidence from public-network evidence.
It is not a deployment approval. The v2 testnet gate remains closed while the
coverage and mutation requirements below are open.

## Toolchain observed

- Acton `1.0.0`, git revision `3a4f0dc`;
- Tolk `1.4.0` through the Acton installation;
- Node.js `v26.7.0`;
- npm `12.0.2`;
- TypeScript cell dependencies from the checked-in lockfile;
- effective Git identity `ef-code` /
  `111162892+EF-Code@users.noreply.github.com`.

## Commands and results

| Gate | Command | Result |
| --- | --- | --- |
| Acton formatting | `acton fmt --check` | PASS |
| Acton static checking | `acton check` | PASS |
| Acton compilation | `acton build` | PASS |
| Acton functional suite | `acton test --fuzz-seed 42` | PASS: 41 tests |
| TypeScript typecheck | `npm run typecheck` | PASS |
| TypeScript build | `npm run build` | PASS |
| TypeScript suite | `npm test` | PASS: 71 tests |
| Clean-directory reproducibility | `tests/v2/reproducibility.test.ts` | PASS |
| Acton gas snapshot | `acton test --snapshot benchmarks/gas-v2.json --fuzz-seed 42` | PASS |
| Acton coverage gate | `acton test --coverage --coverage-format text --coverage-minimum-percent 89 --fuzz-seed 42` | OPEN: 98.3% lines, 74.1% branches, 86.7% blended |
| TypeScript coverage | `npm run test:coverage` | OPEN: 93.03% lines, 74.25% branches |
| v2 critical/major mutation run | `acton test --mutate --mutate-contract TonolithCoreV2 --mutation-levels critical,major --mutation-workers 2 --fuzz-seed 42` | OPEN: 401 killed, 254 survived, 34 compile-invalid, 61.2% score |

The open gates are recorded failures, not waived requirements. The Acton
minimum-score command exits non-zero at the current 86.7% blended score. The
mutation run also fails the required critical-mutant and major-mutant bars.
Survivors need targeted tests or an explicit reviewed reachability disposition
before this record can become a release approval.

The repository does not currently contain a configured local TON validator,
and no `lite-client`, `validator-engine-console`, `toncli`, or validator Docker
image was available during this check. Acton emulation therefore does not prove
validator action rollback, bounce delivery, external-message rejection at the
validator boundary, or final balance reconciliation.

## Gas and batching evidence

The refreshed Acton snapshot in [`../../benchmarks/gas-v2.json`](../../benchmarks/gas-v2.json)
measures these v2 message classes:

- `V2Advance`: 1,844–47,997 gas, average 22,332 across 73 samples;
- `V2DeliverInput`: 309–49,066 gas, average 16,819 across 20 samples;
- `V2DispatchOutput`: 1,877–17,899 gas, average 8,728 across 5 samples;
- `V2InputAccepted`: 309–23,418 gas, average 7,219 across 5 samples;
- `V2TopUp`: 2,546–2,946 gas, average 2,798 across 3 samples.

The complete candidate matrix is [`../../benchmarks/v2/batch-selection.json`](../../benchmarks/v2/batch-selection.json).
The selected value is `MAX_STEPS_PER_ADVANCE = 1`. Its measured worst-case
local contract gas is `47,997`, and its routed-output trace is `48,306` gas.
Candidates 2, 4, 8, 16, and 32 remain below the local 400,000-gas project
ceiling, while 64 reaches `677,438` gas and is rejected. No candidate can pass
the guide's 40%-of-testnet-reference rule until a real testnet reference exists.
Action count, storage-cell growth, message-size, and testnet fee gates remain
open because Acton does not provide a stable release table for those fields.

## Deterministic benchmark vectors

The checked-in vectors in [`../../benchmarks/v2/expected.json`](../../benchmarks/v2/expected.json)
are local-emulator evidence:

- Fibonacci: `1, 1, 2, 3, 5, 8, 13`; 97 instructions and 97 one-step batches;
  final state hash `8238d6bbcd507f4a3b9cba3b1ad48b2d88fd6ab11f7068b75340a3f0044a9f1f`;
- CRC-4: output `5`, 12 instructions;
- cellular automaton: output `0`, 50 instructions;
- counter pipeline: outputs `1, 2`, two acknowledgements;
- two-core 8-bit carry path: carry output `1`, two acknowledgements.

Those hashes prove agreement between the checked-in emulator and its own
canonical inputs. They are not TON transaction or finality evidence.

## Testnet boundary

Two global Acton testnet wallet entries are configured for the project, but no
v2 deployment was attempted from this worktree because the local release gates
are open. No v2 address, transaction, fee, storage balance, keeper race, or
finality claim should be inferred from the wallet configuration.

When the local gates pass, use the procedure in
[`TESTNET_VALIDATION.md`](TESTNET_VALIDATION.md). Record every value from the
chain and explorer output there; never replace a missing value with an emulator
estimate.
