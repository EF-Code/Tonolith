import assert from "node:assert/strict";
import test from "node:test";
import { assembleV2, V2AssemblyError } from "../../packages/artifact/src/assembler.js";

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
