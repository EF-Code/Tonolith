# Tonolith ISA v1

Tonolith v1 is a 4-bit accumulator processor with 16 4-bit registers, 256
4-bit RAM cells, and 1,024 16-bit ROM words. It is inspired by early 4-bit
processors but is not Intel 4004-compatible.

## Encoding

Every instruction is one 16-bit word:

```text
15             12 11                              0
+----------------+---------------------------------+
| opcode: 4 bits | operand: 12 bits                |
+----------------+---------------------------------+
```

Unused operand bits are required to be zero. The assembler, emulator, and
contract all reject non-canonical encodings.

## State

`A` is the 4-bit accumulator. `R0` through `R15` are 4-bit registers. `PC` is
a 10-bit word address. Flag bit 0 is zero (`Z`) and flag bit 1 is carry or
no-borrow (`C`). `OUT` appends to a rolling output commitment; it does not
create an unbounded on-chain array.

