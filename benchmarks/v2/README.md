# Tonolith v2 benchmark suite

The v2 suite is executable, deterministic, and deliberately split into two
evidence classes:

- `local-emulator`: the independent TypeScript execution and message-routing
  results checked by `tests/v2/benchmarks.test.ts`;
- `acton-sandbox`, `local-validator`, and `testnet`: fields reserved for
  measured contract, validator, and public-network evidence.

The checked-in expected vectors are in [`expected.json`](expected.json). They
include the source programs, output vectors, instruction counts, final state
hashes, and multi-core acknowledgement counts. Gas and real network fees stay
`null` until the corresponding environment measures them; they are not inferred
from emulator runtime.

Run the suite with:

```text
npm test -- --test-name-pattern='v2 benchmark suite|bounded checksum|two-core|two 4-bit'
```

The benchmark runner emits per-instruction frames compatible with the v2 trace
schema. A frame is an architectural transition; it is not a claim that a TON
transaction was included or finalized.
