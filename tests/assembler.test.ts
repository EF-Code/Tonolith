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

test("assembler covers every legacy mnemonic and display form", () => {
  const source = `
    NOP
    LDI 0xF
    LDR R15
    STR R0
    ADD R1
    ADC R2
    SUB R3
    AND R4
    OR R5
    XOR R6
    LDM 0xFF
    STM 0x00
    JMP 0x3FF
    JZ 0x3FE
    JC 0x3FD
    HALT
    OUT
    CLC
    STC
    NOT
    SHL
    SHR
    INC
    DEC
  `;
  const result = assemble(source);
  assert.equal(result.words.length, 24);
  assert.deepEqual(result.words.slice(0, 15), [
    encodeInstruction(Opcode.NOP),
    encodeInstruction(Opcode.LDI, 0xf),
    encodeInstruction(Opcode.LDR, 15),
    encodeInstruction(Opcode.STR, 0),
    encodeInstruction(Opcode.ADD, 1),
    encodeInstruction(Opcode.ADC, 2),
    encodeInstruction(Opcode.SUB, 3),
    encodeInstruction(Opcode.AND, 4),
    encodeInstruction(Opcode.OR, 5),
    encodeInstruction(Opcode.XOR, 6),
    encodeInstruction(Opcode.LDM, 0xff),
    encodeInstruction(Opcode.STM, 0),
    encodeInstruction(Opcode.JMP, 0x3ff),
    encodeInstruction(Opcode.JZ, 0x3fe),
    encodeInstruction(Opcode.JC, 0x3fd),
  ]);
  const sysWords = [
    SysOp.HALT,
    SysOp.OUT,
    SysOp.CLC,
    SysOp.STC,
    SysOp.NOT,
    SysOp.SHL,
    SysOp.SHR,
    SysOp.INC,
    SysOp.DEC,
  ];
  assert.deepEqual(result.words.slice(15), sysWords.map((op) => encodeInstruction(Opcode.SYS, op)));
  assert.deepEqual(
    result.words.map((word) => disassembleWord(word)),
    [
      "NOP",
      "LDI 0xF",
      "LDR R15",
      "STR R0",
      "ADD R1",
      "ADC R2",
      "SUB R3",
      "AND R4",
      "OR R5",
      "XOR R6",
      "LDM 0xFF",
      "STM 0x0",
      "JMP 0x3FF",
      "JZ 0x3FE",
      "JC 0x3FD",
      "SYS HALT",
      "SYS OUT",
      "SYS CLC",
      "SYS STC",
      "SYS NOT",
      "SYS SHL",
      "SYS SHR",
      "SYS INC",
      "SYS DEC",
    ],
  );
  assert.throws(() => disassembleWord(0x1010), AssemblyError);
});

test("assembler rejects malformed operands, labels, and numbers", () => {
  const cases = [
    ["NOP extra", /does not take an operand/],
    ["LDI", /numeric operand is required/],
    ["LDI nope", /invalid numeric operand/],
    ["LDI 99999999999999999999", /too large/],
    ["LDR", /register operand is required/],
    ["LDR X1", /invalid register/],
    ["JMP", /branch target is required/],
    ["JMP missing", /unknown label/],
    ["JMP 99999999999999999999", /too large/],
    ["UNKNOWN", /unknown mnemonic/],
    ["NOP extra value", /at most one operand/],
  ] as const;
  for (const [source, pattern] of cases) {
    assert.throws(() => assemble(source), (error: unknown) => error instanceof AssemblyError && pattern.test(error.message), source);
  }
  assert.throws(() => assemble("loop:\nloop:\nNOP"), /duplicate label/);
});
