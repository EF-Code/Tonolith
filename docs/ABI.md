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

### Empty body

An empty internal body is accepted as a no-op. A short non-empty body or an
unknown prefix throws `UnknownMessage`.

## External messages

External input is rejected with `ExternalMessageRejected` (109). Acton’s local
external-message shim returns no transaction and does not execute the contract
hook, so that hook is documented as a local-emulation boundary and remains a
testnet verification item.

## Events

### `CpuAdvanced` — `0x544E4C81`

```text
uint64  queryId
uint64  advanceCount
uint64  startInstruction
uint64  endInstruction
uint256 previousStateHash
uint256 nextStateHash
uint10  finalPc
uint1   status
```

### `CpuOutput` — `0x544E4C82`

```text
uint64  outputIndex
uint64  instructionCount
uint4   value
uint256 outputCommitment
```

The output commitment chains the previous commitment, output index,
instruction count, and 4-bit value under namespace `0x544E4C4F`.

## Error codes

| Code | Meaning |
| ---: | --- |
| 100 | Unknown message |
| 101 | CPU halted |
| 102 | Stale advance count |
| 103 | State hash mismatch |
| 104 | Invalid step count |
| 105 | Insufficient value |
| 106 | Non-canonical instruction |
| 107 | Invalid SYS sub-operation |
| 108 | Invalid storage or internal tree selector |
| 109 | External message rejected |
