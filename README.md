# Tonolith

Tonolith is an experimental, deterministic 4-bit processor implemented as a
TON smart contract.

The v1 design is intentionally chain-native: one immutable-program CPU contract
stores compact architectural state and ROM, and permissionless internal
messages advance bounded instruction batches. The runtime executor is an
optimized architectural transition function; it is not a transistor-accurate
or Intel 4004-compatible implementation.

Current status: the v1 single-instruction contract, canonical ROM/RAM layout,
TypeScript assembler/emulator, differential trace, Fibonacci vector, fuzz and
property tests, coverage, mutation evidence, and gas snapshot are implemented.
The local candidate is testnet-ready but has not been testnet-proven. The
The implementation status and acceptance evidence are summarized below and in
the linked release documentation.

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

The selected `MAX_STEPS_PER_ADVANCE` is one instruction. The measured local
worst-case accepted `Advance` path is 19,527 gas, below the v1 800,000-gas
ceiling. See [docs/LOCAL_RELEASE.md](docs/LOCAL_RELEASE.md) for the complete
evidence and known local-emulation boundaries.

The testnet-only deployment runbook is [docs/TESTNET.md](docs/TESTNET.md), and
the Fibonacci script is `scripts/deploy-fibonacci.tolk`. It requires a funded
Acton wallet named `tonolith-testnet`; no wallet or secret is created by this
repository. See [docs/CLAIMS.md](docs/CLAIMS.md) for the distinction between
local proof, testnet proof, and unresolved production gates.

Additional design references:

- [docs/ISA.md](docs/ISA.md) — canonical instruction encoding and state model;
- [docs/ROM.md](docs/ROM.md) — ROM/RAM cell layout and commitments;
- [docs/ABI.md](docs/ABI.md) — messages, events, and error codes.

## Claims boundary

Tonolith v1 must not be described as transistor-accurate, gate-level executed,
Intel 4004-compatible, autonomous, or production-ready unless the corresponding
evidence is separately published.
