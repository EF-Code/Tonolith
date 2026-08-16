import { beginCell, type Cell } from "@ton/core";
import { RAM_NIBBLES, ROM_WORDS } from "../../isa/src/constants.js";

const WORDS_PER_LEAF = 32;
const WORDS_PER_HALF = 16;
const LEAVES_PER_LEVEL1 = 4;
const LEVEL1_PER_LEVEL2 = 4;
const HALF_MASK = (1n << 256n) - 1n;

export const V2_MEMORY_LAYOUT = {
  romWords: ROM_WORDS,
  romWordsPerLeaf: WORDS_PER_LEAF,
  romWordsPerHalf: WORDS_PER_HALF,
  leavesPerLevel1: LEAVES_PER_LEVEL1,
  level1PerLevel2: LEVEL1_PER_LEVEL2,
  ramNibbles: RAM_NIBBLES,
  ramNibblesPerPage: 64,
  ramPages: 4,
} as const;

export function normalizeRom(words: readonly number[]): number[] {
  if (words.length > ROM_WORDS) throw new RangeError(`ROM contains ${words.length} words; maximum is ${ROM_WORDS}`);
  return Array.from({ length: ROM_WORDS }, (_, index) => {
    const word = words[index] ?? 0;
    if (!Number.isInteger(word) || word < 0 || word > 0xffff) throw new RangeError(`ROM word ${index} must be 16-bit unsigned`);
    return word;
  });
}

export function romRootCell(words: readonly number[] = []): Cell {
  const normalized = normalizeRom(words);
  const leaves = Array.from({ length: ROM_WORDS / WORDS_PER_LEAF }, (_, index) => {
    const start = index * WORDS_PER_LEAF;
    return romLeafCell(normalized.slice(start, start + WORDS_PER_LEAF));
  });
  const level1 = group4(leaves, romLevel1Cell);
  const level2 = group4(level1, romLevel2Cell);
  const zeroLeaf = romLeafCell(Array.from({ length: WORDS_PER_LEAF }, () => 0));
  const zeroLevel1 = romLevel1Cell(Array.from({ length: LEAVES_PER_LEVEL1 }, () => zeroLeaf));
  const zeroLevel2 = romLevel2Cell(Array.from({ length: LEVEL1_PER_LEVEL2 }, () => zeroLevel1));
  return beginCell()
    .storeRef(level2[0]!)
    .storeRef(level2[1]!)
    .storeRef(zeroLevel2)
    .storeRef(zeroLevel2)
    .endCell();
}

export function romRoot(words: readonly number[] = []): string {
  return romRootCell(words).hash().toString("hex");
}

export function romWord(words: readonly number[], address: number): number {
  if (!Number.isInteger(address) || address < 0 || address >= ROM_WORDS) throw new RangeError("ROM address must be 0..1023");
  return normalizeRom(words)[address] ?? 0;
}

export function normalizeRam(ram: readonly number[] | Uint8Array): Uint8Array {
  if (ram.length > RAM_NIBBLES) throw new RangeError(`RAM contains ${ram.length} nibbles; maximum is ${RAM_NIBBLES}`);
  const normalized = new Uint8Array(RAM_NIBBLES);
  for (let index = 0; index < ram.length; index += 1) {
    const value = ram[index] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 0xf) throw new RangeError(`RAM nibble ${index} must be 0..15`);
    normalized[index] = value;
  }
  return normalized;
}

export function ramPageCell(ram: readonly number[] | Uint8Array, pageIndex: number): Cell {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= 4) throw new RangeError("RAM page must be 0..3");
  const normalized = normalizeRam(ram);
  let packed = 0n;
  for (let offset = 0; offset < 64; offset += 1) {
    packed |= BigInt(normalized[pageIndex * 64 + offset] ?? 0) << BigInt(offset * 4);
  }
  return beginCell().storeUint(packed, 256).endCell();
}

export function ramRootCell(ram: readonly number[] | Uint8Array = new Uint8Array(RAM_NIBBLES)): Cell {
  const normalized = normalizeRam(ram);
  return beginCell()
    .storeRef(ramPageCell(normalized, 0))
    .storeRef(ramPageCell(normalized, 1))
    .storeRef(ramPageCell(normalized, 2))
    .storeRef(ramPageCell(normalized, 3))
    .endCell();
}

export function ramRoot(ram: readonly number[] | Uint8Array = new Uint8Array(RAM_NIBBLES)): string {
  return ramRootCell(ram).hash().toString("hex");
}

function romLeafCell(words: readonly number[]): Cell {
  if (words.length !== WORDS_PER_LEAF) throw new RangeError("ROM leaf must contain 32 words");
  return beginCell()
    .storeUint(packHalf(words.slice(0, WORDS_PER_HALF)), 256)
    .storeUint(packHalf(words.slice(WORDS_PER_HALF)), 256)
    .endCell();
}

function packHalf(words: readonly number[]): bigint {
  if (words.length !== WORDS_PER_HALF) throw new RangeError("ROM half must contain 16 words");
  return words.reduce((packed, word) => ((packed << 16n) | BigInt(word)) & HALF_MASK, 0n);
}

function romLevel1Cell(children: readonly Cell[]): Cell {
  if (children.length !== 4) throw new RangeError("ROM level 1 node must contain four leaves");
  return beginCell().storeRef(children[0]!).storeRef(children[1]!).storeRef(children[2]!).storeRef(children[3]!).endCell();
}

function romLevel2Cell(children: readonly Cell[]): Cell {
  if (children.length !== 4) throw new RangeError("ROM level 2 node must contain four level 1 nodes");
  return beginCell().storeRef(children[0]!).storeRef(children[1]!).storeRef(children[2]!).storeRef(children[3]!).endCell();
}

function group4<T>(values: readonly T[], builder: (children: readonly T[]) => Cell): Cell[] {
  if (values.length % 4 !== 0) throw new RangeError("tree level is not divisible by four");
  return Array.from({ length: values.length / 4 }, (_, index) => builder(values.slice(index * 4, index * 4 + 4)));
}
