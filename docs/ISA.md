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
