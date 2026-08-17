import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { assembleFileV2, assembleV2, V2AssemblyError } from "../../packages/artifact/src/assembler.js";

test("v2 assembler supports labels, forward references, directives, and v2 SYS syntax", () => {
  const result = assembleV2(`
    .entry start
    .export start
    .ram 0x10, 0xA
    .nibble 0xFF 0xB
  start:
    JMP next
    IN 3
  next:
    OUTP 2
    YIELD
    TRAP 0x7f
    .org 8
    .word 0x0000
  `);
  assert.equal(result.entryPc, 0);
  assert.equal(result.labels.start, 0);
  assert.equal(result.labels.next, 2);
  assert.equal(result.exports.start, 0);
  assert.equal(result.words[0], 0xc002);
  assert.equal(result.words[1], 0xf039);
  assert.equal(result.words[2], 0xf02a);
  assert.equal(result.words[3], 0xf00b);
  assert.equal(result.words[4], 0xf7fc);
  assert.equal(result.words[8], 0);
  assert.equal(result.ram[0x10], 0xa);
  assert.equal(result.ram[0xff], 0xb);
  assert.equal(result.sourceMap.length, 6);
  assert.equal(result.sourceMap[0]?.address, 0);
});

test("v2 assembler rejects overlapping segments, unknown symbols, and noncanonical words", () => {
  assert.throws(() => assembleV2(".org 1\n.word 0\n.org 1\nNOP"), (error: unknown) => error instanceof V2AssemblyError && error.code === "OVERLAPPING_SEGMENT");
  assert.throws(() => assembleV2("JMP missing"), (error: unknown) => error instanceof V2AssemblyError && error.code === "UNKNOWN_SYMBOL");
  assert.throws(() => assembleV2(".word 0xf00d"), (error: unknown) => error instanceof V2AssemblyError && error.code === "INVALID_SYS_SUBOP");
  assert.throws(() => assembleV2(".ram 0 1\n.nibble 0 2"), (error: unknown) => error instanceof V2AssemblyError && error.code === "OVERLAPPING_SEGMENT");
});

test("v2 assembler output is deterministic and zero-fills omitted ROM and RAM", () => {
  const source = ".entry 0\nLDI 1\n";
  const first = assembleV2(source);
  const second = assembleV2(source);
  assert.deepEqual(first.words, second.words);
  assert.deepEqual([...first.ram], [...second.ram]);
  assert.equal(first.words.length, 1024);
  assert.equal(first.ram.length, 256);
  assert.equal(first.words.slice(1).every((word) => word === 0), true);
  assert.equal(first.ram.every((value) => value === 0), true);
  assert.equal(first.canonicalSource, second.canonicalSource);
});

test("v2 assembler parses every instruction family and include graph", async () => {
  const root = await mkdtemp(join(process.cwd(), ".tmp-v2-assembler-"));
  try {
    await writeFile(join(root, "child.tasm"), "child:\nLDI 0xA\n", "utf8");
    await writeFile(join(root, "main.tasm"), `
      .entry start
      .export start
      .include "child.tasm"
      start:
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
      LDM 0xff
      STM 0x00
      JMP start
      JZ start
      JC start
      HALT
      OUT
      CLC
      STC
      NOT
      SHL
      SHR
      INC
      DEC
      IN 0
      OUTP 15
      YIELD
      TRAP 0xff
      SYS 0x0c
    `, "utf8");
    const result = assembleFileV2(join(root, "main.tasm"), { rootDir: root });
    assert.equal(result.labels.start, 1);
    assert.equal(result.exports.start, 1);
    assert.equal(result.words[1], 0);
    assert.equal(result.words[2], 0x100f);
    assert.equal(result.words[3], 0x200f);
    assert.equal(result.words[25], 0xf009);
    assert.equal(result.words[26], 0xf0fa);
    assert.equal(result.words[27], 0xf00b);
    assert.equal(result.words[28], 0xfffc);
    assert.equal(result.words[29], 0xf00c);
    assert.ok(result.canonicalSource.includes("child.tasm"));
    assert.equal(result.sourceMap[0]?.file, "child.tasm");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 assembler reports directive, operand, symbol, include, and range errors", () => {
  const cases: Array<[string, string]> = [
    [".org 0 1", "INVALID_DIRECTIVE"],
    [".word", "INVALID_DIRECTIVE"],
    [".ram 0", "INVALID_DIRECTIVE"],
    [".entry 0\n.entry 1\nNOP", "DUPLICATE_ENTRY"],
    [".export missing\nNOP", "UNKNOWN_SYMBOL"],
    [".export start\n.export start\nstart:\nNOP", "DUPLICATE_SYMBOL"],
    [".include \"child.tasm\"", "INCLUDE_REQUIRES_FILE"],
    [".entry 4\nNOP", "INVALID_ENTRY"],
    ["start:\nstart:\nNOP", "DUPLICATE_SYMBOL"],
    ["LDI", "MISSING_OPERAND"],
    ["LDI nope", "INVALID_NUMBER"],
    ["LDI 16", "OUT_OF_RANGE"],
    ["LDR", "MISSING_OPERAND"],
    ["LDR R16", "INVALID_REGISTER"],
    ["NOP 1", "UNEXPECTED_OPERAND"],
    ["SYS", "MISSING_OPERAND"],
    ["SYS nope", "INVALID_NUMBER"],
    ["IN 16", "OUT_OF_RANGE"],
    ["TRAP 0x100", "OUT_OF_RANGE"],
    ["UNKNOWN", "UNKNOWN_MNEMONIC"],
    ["NOP extra value", "INVALID_INSTRUCTION"],
    [".org 0x400", "OUT_OF_RANGE"],
    [".ram 0x100 0", "OUT_OF_RANGE"],
    [".ram 0 0x10", "OUT_OF_RANGE"],
    [".word 0xf00d", "INVALID_SYS_SUBOP"],
  ];
  for (const [source, code] of cases) {
    assert.throws(() => assembleV2(source), (error: unknown) => error instanceof V2AssemblyError && error.code === code, source);
  }
});

test("v2 assembler rejects include escapes and cycles", async () => {
  const root = await mkdtemp(join(process.cwd(), ".tmp-v2-assembler-errors-"));
  const outside = await mkdtemp(join(process.cwd(), ".tmp-v2-assembler-outside-"));
  try {
    await writeFile(join(root, "cycle-a.tasm"), ".include \"cycle-b.tasm\"\nNOP\n", "utf8");
    await writeFile(join(root, "cycle-b.tasm"), ".include \"cycle-a.tasm\"\nNOP\n", "utf8");
    await writeFile(join(root, "escape.tasm"), ".include \"../tmp-v2-assembler-outside/missing.tasm\"\nNOP\n", "utf8");
    assert.throws(() => assembleFileV2(join(root, "cycle-a.tasm"), { rootDir: root }), /cyclic include/);
    assert.throws(() => assembleFileV2(join(root, "escape.tasm"), { rootDir: root }), /include escapes assembler root/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
