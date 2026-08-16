import assert from "node:assert/strict";
import test from "node:test";

import { romRootCell, romRootHash, romWord, staticCommitment } from "../tools/rom/rom.js";

test("TypeScript ROM tree preserves canonical zero and boundary words", () => {
  const zero = romRootCell();
  assert.equal(romWord([], 0), 0);
  assert.equal(romWord([], 1023), 0);
  assert.equal(romRootHash([]), BigInt(`0x${zero.hash().toString("hex")}`));
});

test("TypeScript ROM tree packs both halves and all four-way selectors", () => {
  const words = Array.from({ length: 1024 }, (_, index) => index & 0xffff);
  assert.equal(romWord(words, 0), 0);
  assert.equal(romWord(words, 16), 16);
  assert.equal(romWord(words, 31), 31);
  assert.equal(romWord(words, 32), 32);
  assert.equal(romWord(words, 128), 128);
  assert.equal(romWord(words, 512), 512);
  assert.equal(romWord(words, 1023), 1023);
});

test("static commitment is deterministic and changes with ROM", () => {
  const zero = staticCommitment([]);
  const changed = staticCommitment([0x1001]);
  assert.notEqual(changed, zero);
  assert.equal(staticCommitment([0x1001]), changed);
});
