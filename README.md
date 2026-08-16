# Tonolith

Tonolith is a deterministic 4-bit processor implemented as a TON smart
contract.

The v1 design is intentionally chain-native: one immutable-program CPU contract
stores compact architectural state and ROM, and permissionless internal
messages advance bounded instruction batches. The runtime executor is an
optimized architectural transition function designed for compact,
deterministic on-chain execution.

Current status: Tonolith v1 has a single-instruction contract, canonical
ROM/RAM layout, TypeScript assembler/emulator, differential trace, Fibonacci
vector, fuzz and property tests, coverage, mutation evidence, gas snapshot, and
a completed public testnet Fibonacci run. The implementation status and
acceptance evidence are summarized below and in the linked release
documentation.

## Evidence at a glance

- **18/18** Acton contract tests pass, including the 256-run fuzz test and the
  97-step Fibonacci trace.
- **99.7%** contract line coverage and **89.9%** blended Acton coverage.
- **96.1%** critical and major mutation score: 223 of 238 mutants killed.
- **19,527 gas** measured worst-case accepted `Advance` path across 198 gas
  samples, with `MAX_STEPS_PER_ADVANCE = 1`.
- **1,024 iterations** in the deterministic TypeScript property test, with
  opcode, assembler, ROM, and differential test suites passing.
- **21-word** Fibonacci program running inside a **1,024-word** ROM and
  **256-nibble** RAM architecture.

## Verified testnet run

The Fibonacci instance completed on TON testnet in **98 account-history
transactions**: one deployment followed by **97 accepted one-instruction
advances**. The contract emitted the canonical sequence:

```text
1, 1, 2, 3, 5, 8, 13
```

The final state is HALT at program counter 21 with instruction count 97,
output register 13, and core state hash
`16925a27b1db66171cebb3d43c74702f06f4a362e302754f24026cca0a6bf2be`.

- [Open the Tonolith Fibonacci contract on TON testnet](https://testnet.tonviewer.com/kQDCENlXgMC1FOWvEtM2wKcJHBLKS86Tbkv9xkT0u5aIa1av)
- [Open the deployment transaction](https://testnet.tonviewer.com/transaction/5a8c2ef9ff188f76ddd68f2b9700a5266aaac9c74bf35f4b797746d69f1daca7)
- ROM root: `029ccf15774f680518705bb7c8be4b2ca92f34a4ceb9c963e55609225398c748`
- Static commitment: `50da71fe389768e885c8258c7f4f4a97b86598738eed974336d527e459024f08`

## Visualizer

The companion [Tonolith Visualizer](https://github.com/EF-Code/tonolith-visualizer)
replays the public Fibonacci run as a working CPU: transaction timeline,
instruction flow, registers, RAM, output events, and state-commitment changes
are all shown in sequence.

## Development

Requirements:

- Acton 1.0.0;
- Node.js and npm for the TypeScript emulator, assembler, and tooling.

Initial local checks:

```sh
acton check
acton build
acton test
npm ci
npm run typecheck
npm test
npm run build

# Contract coverage and gas evidence
acton test --coverage --coverage-format text --coverage-minimum-percent 89
acton test --snapshot benchmarks/gas-v1.json --fuzz-seed 42

# Critical and major mutation gate
acton test --mutate --mutate-contract TonolithCpu --mutation-levels critical,major
```

The selected `MAX_STEPS_PER_ADVANCE` is one instruction. The measured
worst-case accepted `Advance` path is 19,527 gas, below the v1 800,000-gas
ceiling. See [docs/LOCAL_RELEASE.md](docs/LOCAL_RELEASE.md) for the complete
local evidence and [docs/TESTNET.md](docs/TESTNET.md) for the public testnet
run record.

The testnet-only deployment runbook is [docs/TESTNET.md](docs/TESTNET.md), and
the Fibonacci script is `scripts/deploy-fibonacci.tolk`. It requires a funded
Acton wallet named `tonolith-testnet`; no wallet or secret is created by this
repository. See [docs/CLAIMS.md](docs/CLAIMS.md) for the evidence record and
release context.

Additional design references:

- [docs/ISA.md](docs/ISA.md) — canonical instruction encoding and state model;
- [docs/ROM.md](docs/ROM.md) — ROM/RAM cell layout and commitments;
- [docs/ABI.md](docs/ABI.md) — messages, events, and error codes.

## Scope

Tonolith defines a compact, deterministic architectural machine for TON. The
repository separates executable implementation evidence, public-network
observations, and broader interpretations so each release can be read at the
level supported by its evidence.
