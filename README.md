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
implementation plan and acceptance criteria are in
[TONOLITH_IMPLEMENTATION_GUIDE.md](TONOLITH_IMPLEMENTATION_GUIDE.md).

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

