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

## Instructions

| Opcode | Instruction | Operand | Meaning |
|---:|---|---|---|
| `0x0` | `NOP` | `0` | No-op |
| `0x1` | `LDI imm4` | low 4 bits | Load immediate into `A` |
| `0x2` | `LDR r` | low 4 bits | Load `R[r]` into `A` |
| `0x3` | `STR r` | low 4 bits | Store `A` into `R[r]` |
| `0x4` | `ADD r` | low 4 bits | Add `R[r]`, set carry on overflow |
| `0x5` | `ADC r` | low 4 bits | Add `R[r]` and incoming carry |
| `0x6` | `SUB r` | low 4 bits | Subtract `R[r]`, set carry on no-borrow |
| `0x7` | `AND r` | low 4 bits | Bitwise AND and clear carry |
| `0x8` | `OR r` | low 4 bits | Bitwise OR and clear carry |
| `0x9` | `XOR r` | low 4 bits | Bitwise XOR and clear carry |
| `0xA` | `LDM addr8` | low 8 bits | Load RAM nibble |
| `0xB` | `STM addr8` | low 8 bits | Store RAM nibble |
| `0xC` | `JMP addr10` | low 10 bits | Unconditional jump |
| `0xD` | `JZ addr10` | low 10 bits | Jump when `Z` is set |
| `0xE` | `JC addr10` | low 10 bits | Jump when `C` is set |
| `0xF` | `SYS subop` | low 4 bits | System and accumulator operations |

`SYS` suboperations are `HALT=0`, `OUT=1`, `CLC=2`, `STC=3`, `NOT=4`,
`SHL=5`, `SHR=6`, `INC=7`, and `DEC=8`. Other values are invalid.

The program counter advances before a branch decision. A successful instruction
increments `instructionCount` once. `HALT` leaves the incremented PC in state
and prevents future instruction execution.
