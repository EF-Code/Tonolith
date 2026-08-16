# Tonolith v1 message ABI

All message prefixes and event prefixes are 32-bit values. Numeric fields are
serialized in the order shown below.

## Internal messages

### `Advance` — `0x544E4C01`

```text
uint64  queryId
uint64  expectedAdvanceCount
uint256 expectedStateHash
uint16  maxInstructions
```

The v1 contract accepts exactly one instruction per message:
`1 <= maxInstructions <= MAX_STEPS_PER_ADVANCE`, with
`MAX_STEPS_PER_ADVANCE = 1`. The message value must be at least `0.01 TON`.
The expected advance count and state hash are checked before execution. A
stale or racing keeper therefore fails without mutating state.

Accepted execution reserves `0.1 TON` when available, updates the core once,
emits events, and sends the safe excess back to the sender. The current design
uses a carry-all-remaining-value refund action; actual network fees remain
network-dependent.

### `TopUp` — `0x544E4C02`

`TopUp` has no fields. It accepts value and leaves the CPU state unchanged.

