# Tonolith v2 local release record

This record separates reproducible local evidence from public-network evidence.
It is not a deployment approval. The v2 testnet gate remains closed while the
guide's raw contract-branch threshold and validator/testnet evidence remain
open.

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
| Acton functional suite | `acton test --fuzz-seed 42` | PASS: 48 tests |
| TypeScript typecheck | `npm run typecheck` | PASS |
| TypeScript build | `npm run build` | PASS |
| TypeScript suite | `npm test` | PASS: 99 tests |
| Clean-directory reproducibility | `tests/v2/reproducibility.test.ts` | PASS |
| Local Acton Fibonacci script | `acton script scripts/deploy-v2-fibonacci.tolk` | PASS: halted after 97 one-step advances with 7 outputs; final hash agrees with TypeScript |
| Acton gas snapshot | `acton test --snapshot benchmarks/gas-v2.json --fuzz-seed 42` | PASS: current v2 snapshot checked in |
| Acton source-level union coverage | `npm run test:contract:coverage` | PASS for repository gate: 99.87% lines, 77.39% raw branch edges, 89.80% blended |
| TypeScript coverage | `npm run test:coverage` | PASS: 99.04% lines, 90.46% branches, 98.79% functions |
| v2 release-delta mutation run | `npm run test:contract:mutation` | PASS: 22 mutants, 21 killed, 1 compile-invalid, 0 survivors, 100.0% score |
| v2 full dependency mutation audit | `acton test --mutate --mutate-contract TonolithCoreV2 --mutation-levels critical,major --mutation-workers 2 --fuzz-seed 42` | OPEN: 615 mutants, 555 killed, 31 survivors, 29 compile-invalid, 94.7% score |

The raw branch-edge percentage is reported separately because it remains below
the guide's 90% branch threshold; the repository gate uses the documented
source-level union line and blended thresholds and does not relabel 77.39% as
90%. The mutation command is intentionally scoped to the release delta from
`44f8925`; the full dependency audit still has 31 survivors in defensive queue,
route, and storage branches and is not presented as a 100% production gate.
These measurements are local evidence, not a production approval.

The repository does not currently contain a configured local TON validator,
and no `lite-client`, `validator-engine-console`, `toncli`, or validator Docker
image was available during this check. `docker info` also failed because the
installed Docker service was inactive and `/var/run/docker.sock` did not exist.
Acton emulation therefore does not prove validator action rollback, bounce
delivery, external-message rejection at the validator boundary, or final
balance reconciliation.

## Gas and batching evidence

The refreshed Acton snapshot in [`../../benchmarks/gas-v2.json`](../../benchmarks/gas-v2.json)
measures these v2 message classes:

- `V2Advance`: 1,766–92,799 gas, average 28,609 across 164 samples;
- `V2DeliverInput`: 309–110,649 gas, average 20,800 across 32 samples;
- `V2DispatchOutput`: 1,799–18,637 gas, average 7,363 across 13 samples;
- `V2InputAccepted`: 309–143,907 gas, average 42,369 across 32 samples;
- `V2TopUp`: 1,960–2,946 gas, average 2,588 across 4 samples.

The complete candidate matrix is [`../../benchmarks/v2/batch-selection.json`](../../benchmarks/v2/batch-selection.json).
The selected value is `MAX_STEPS_PER_ADVANCE = 1`. Its measured worst-case
local contract gas is `47,182`, and its worst-case trace is `47,491` gas. The
2/4/8/16/32/64 candidates are not accepted by the immutable single-step
profile and are therefore not represented as accepted gas measurements. No
candidate can pass the guide's 40%-of-testnet-reference rule until a real
testnet reference exists. Action count, storage-cell growth, message-size, and
testnet fee gates remain open because Acton does not provide a stable release
table for those fields.

## Deterministic benchmark vectors

The checked-in vectors in [`../../benchmarks/v2/expected.json`](../../benchmarks/v2/expected.json)
are local-emulator evidence:

- Fibonacci: `1, 1, 2, 3, 5, 8, 13`; 97 instructions and 97 one-step batches;
  final state hash `8238d6bbcd507f4a3b9cba3b1ad48b2d88fd6ab11f7068b75340a3f0044a9f1f`;
- CRC-4: output `5`, 12 instructions;
- cellular automaton: output `0`, 50 instructions;
- counter pipeline: outputs `1, 2`, two acknowledgements;
- two-core 8-bit carry path: carry output `1`, two acknowledgements.

The local Acton Fibonacci script reached the same halted state and printed the
same final hash as a decimal `uint256`; rendering that value as fixed-width
hex gives `8238d6bbcd507f4a3b9cba3b1ad48b2d88fd6ab11f7068b75340a3f0044a9f1f`.
This is local Tolk/TypeScript agreement, not TON transaction or finality
evidence.

## Testnet boundary

Two global Acton testnet wallet entries are configured for the project, but no
v2 deployment was attempted because the guide's raw branch gate and the local
validator boundary remain open. No v2 address, transaction, fee, storage
balance, keeper race, or finality claim should be inferred from the wallet
configuration.

When the local gates pass, use the procedure in
[`TESTNET_VALIDATION.md`](TESTNET_VALIDATION.md). Record every value from the
chain and explorer output there; never replace a missing value with an emulator
estimate.
