import assert from "node:assert/strict";
import test from "node:test";
import { assemble, AssemblyError, disassembleWord } from "../tools/assembler/assembler.js";
import { Opcode, encodeInstruction, SysOp } from "../tools/isa/isa.js";

test("assembler resolves labels and disassembles canonical words", () => {
  const result = assemble(`
    LDI 1
    JMP LOOP
  LOOP:
    OUT
    HALT
  `);
  assert.deepEqual(result.words, [
    encodeInstruction(Opcode.LDI, 1),
    encodeInstruction(Opcode.JMP, 2),
    encodeInstruction(Opcode.SYS, SysOp.OUT),
    encodeInstruction(Opcode.SYS, SysOp.HALT),
  ]);
  assert.equal(result.labels.LOOP, 2);
  assert.equal(disassembleWord(result.words[0] ?? 0), "LDI 0x1");
  assert.equal(disassembleWord(result.words[2] ?? 0), "SYS OUT");
});

test("assembler accepts comments and register aliases", () => {
  const result = assemble(`
    ; comment
    LDI 0xA # inline comment
    STR R15
    LDM 255
    STM 0x00
  `);
  assert.equal(result.words.length, 4);
  assert.equal(result.words[1], encodeInstruction(Opcode.STR, 15));
  assert.equal(result.words[2], encodeInstruction(Opcode.LDM, 255));
});

test("assembler reports useful source errors", () => {
  assert.throws(() => assemble("JMP missing"), (error: unknown) => {
    return error instanceof AssemblyError && error.line === 1 && /unknown label/.test(error.message);
  });
  assert.throws(() => assemble("LDI 16"), AssemblyError);
  assert.throws(() => assemble("OUT R1"), AssemblyError);
});
