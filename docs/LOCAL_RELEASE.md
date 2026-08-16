# Local v1 release evidence

This document records the local release candidate. It is deliberately separate
from public-network evidence.

## Toolchain

- Acton 1.0.0;
- Tolk 1.4.0 through Acton;
- Node.js 26 and npm 12;
- TypeScript emulator/assembler with pinned TON cell dependencies.

## Required commands

```sh
acton fmt --check
acton check
acton build
acton test --fuzz-seed 42
acton test --coverage --coverage-format text --coverage-minimum-percent 89 --fuzz-seed 42
acton test --snapshot benchmarks/gas-v1.json --fuzz-seed 42
acton test --mutate --mutate-contract TonolithCpu \
  --mutation-levels critical,major --mutation-workers 2 --fuzz-seed 42
npm run typecheck
npm test
npm run build
```

## Current results

- Acton: 18/18 contract tests pass, including the 256-run fuzz test with seed
  42 and the 97-step Fibonacci trace.
- TypeScript: 7 test files pass, including a 1,024-iteration deterministic
  property test, assembler tests, emulator opcode tests, ROM tests, and the
  Tolk-versus-TypeScript differential trace.
- Coverage: 378/379 lines (99.7%), 299/374 branches (79.9%), Acton blended
  Score 89.9%. Handwritten contract line coverage is 99.0% for
  `TonolithCpu.tolk` and 100.0% for `types.tolk`. The one uncovered line is the
  external rejection hook, which the local external-message shim does not
  execute. Acton’s Score includes compiler-generated serializer/range-check
  branches; the line-coverage target is exceeded, while the blended score is
  reported honestly rather than rounded up.
- Mutation: the authoritative clean-cache critical+major run killed 223 of 238
  mutants; 6 mutants were compile-invalid; 9 survived (96.1% mutation score).
  Survivors are the uninvoked external hook and defensive invalid-index
  selector checks whose invalid branches are not reachable from typed ROM/RAM
  address derivation. Arithmetic, persistence, message, opcode, ROM-leaf,
  stale-state, and failure-path mutants were killed.
- Gas snapshot: accepted `Advance` min 1,588, max 19,527, average 15,266 gas
  across 198 samples. `TopUp` measured 1,328–1,373 gas. The selected
  `MAX_STEPS_PER_ADVANCE` is 1; no batching was enabled before measuring a
  worst-case path.

## Release decision

The local v1 candidate is suitable for a testnet attempt only. It is not a
mainnet or production release. Testnet remains gated on a funded
`tonolith-testnet` wallet and reachable provider credentials.
