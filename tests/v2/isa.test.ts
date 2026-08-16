import assert from "node:assert/strict";
import test from "node:test";
import { SYS } from "../../packages/isa/src/constants.js";
import {
  decodeInstruction,
  disassembleWord,
  encodeInstruction,
  encodePortInstruction,
  encodeTrap,
  V2IsaError,
} from "../../packages/isa/src/codec.js";
import { Opcode } from "../../packages/isa/src/types.js";

test("v2 retains canonical encoding for every v1 opcode family", () => {
  const words = [
    encodeInstruction(Opcode.NOP),
    encodeInstruction(Opcode.LDI, 15),
    encodeInstruction(Opcode.LDR, 15),
    encodeInstruction(Opcode.STR, 15),
    encodeInstruction(Opcode.ADD, 15),
    encodeInstruction(Opcode.ADC, 15),
    encodeInstruction(Opcode.SUB, 15),
    encodeInstruction(Opcode.AND, 15),
    encodeInstruction(Opcode.OR, 15),
    encodeInstruction(Opcode.XOR, 15),
    encodeInstruction(Opcode.LDM, 255),
    encodeInstruction(Opcode.STM, 255),
    encodeInstruction(Opcode.JMP, 1023),
    encodeInstruction(Opcode.JZ, 1023),
    encodeInstruction(Opcode.JC, 1023),
    encodeInstruction(Opcode.SYS, SYS.DEC),
  ];
  for (const word of words) {
    assert.equal(decodeInstruction(word).word, word);
  }
});

test("v2 port and trap instructions expose structured operands", () => {
  const input = encodePortInstruction(SYS.IN, 7);
  assert.deepEqual(decodeInstruction(input), {
    word: input,
    opcode: Opcode.SYS,
    operand: 0x79,
    sysSubop: SYS.IN,
    port: 7,
  });
  const output = encodePortInstruction(SYS.OUTP, 15);
  assert.equal(disassembleWord(output), "OUTP 15");
  const trap = encodeTrap(0xab);
  assert.deepEqual(decodeInstruction(trap), {
    word: trap,
    opcode: Opcode.SYS,
    operand: 0xabc,
    sysSubop: SYS.TRAP,
    trapCode: 0xab,
  });
});

test("v2 rejects noncanonical and invalid SYS operands", () => {
  const invalid: Array<() => number> = [
    () => encodeInstruction(Opcode.NOP, 1),
    () => encodeInstruction(Opcode.LDI, 16),
    () => encodeInstruction(Opcode.SYS, SYS.YIELD | 0x10),
    () => encodeInstruction(Opcode.SYS, 0x0d),
    () => encodePortInstruction(SYS.IN, 16),
    () => encodeTrap(256),
  ];
  for (const make of invalid) {
    assert.throws(make, (error: unknown) => error instanceof V2IsaError);
  }
});
