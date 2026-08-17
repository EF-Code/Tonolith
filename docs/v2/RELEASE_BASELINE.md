# Tonolith v1 baseline for v2 work

This record freezes the evidence reproduced before v2 implementation began.
It is a local engineering baseline, not a new deployment claim.

## Source and tools

- branch at baseline: `main`;
- baseline commit: `8663815`;
- Acton: `1.0.0 (3a4f0dc 2026-05-11)`;
- local Tolk executable: `1.3.0`;
- Node.js: `v26.7.0`;
- npm: `12.0.2`;
- effective Git identity: `ef-code` /
  `111162892+EF-Code@users.noreply.github.com`.

## Reproduced local gates

The following commands passed before v2 edits:

```text
acton fmt --check
acton check
acton build
acton test --fuzz-seed 42
acton test --coverage --coverage-format text --coverage-minimum-percent 89 --fuzz-seed 42
acton test --snapshot benchmarks/gas-v1.json --fuzz-seed 42
acton test --mutate --mutate-contract TonolithCpu --mutation-levels critical,major --mutation-workers 2 --fuzz-seed 42
npm run typecheck
npm test
npm run build
```

Results:

- 18/18 Acton contract tests pass;
- 21 TypeScript tests pass;
- 378/379 lines and 299/374 branches are covered by Acton;
- blended Acton score is 89.9%;
- mutation run: 223 killed, 9 survived, 6 compile-invalid, 238 total;
- accepted v1 `Advance`: 1,588 minimum, 19,527 maximum, 15,266 average gas;
- v1 batch cap: one instruction;
- Fibonacci output: `1, 1, 2, 3, 5, 8, 13`;
- Fibonacci final state hash:
  `16925a27b1db66171cebb3d43c74702f06f4a362e302754f24026cca0a6bf2be`.

The mutation survivors are retained as baseline evidence. They concern the
Acton external-message shim and defensive out-of-range selectors that v1's
typed address derivation cannot reach. V2 must test equivalent paths through
its own validator-compatible boundary rather than silently inheriting the gap.

## Untouched guide hashes at phase start

These values were recorded before implementation edits:

```text
TONOLITH_IMPLEMENTATION_GUIDE.md
1cd946c1765258962ffb198fabbc3f857160e680e23799cfb15070cb7e723d74

TONOLITH_V2_ENGINEERING_GUIDE.md
c87e421658a3fa48d115550bcfc5c0db8c1fb525a526e4c107e57907dc25b620
```

The files are intentionally excluded from v2 commits.

## Public v1 reference

The existing testnet Fibonacci contract and its transaction evidence remain the
v1 public reference. V2 reports must label new local, local-validator, and
testnet results separately from that run.
