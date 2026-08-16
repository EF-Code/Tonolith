import { beginCell, type Cell } from "@ton/core";
import {
  ISA_VERSION,
  ROM_WORDS,
  SCHEMA_VERSION,
  STATIC_COMMITMENT_NAMESPACE,
  WORD_MASK,
} from "../isa/constants.js";

const WORDS_PER_LEAF = 32;
const WORDS_PER_HALF = 16;
const LEAVES_PER_LEVEL1 = 4;
const LEVEL1_PER_LEVEL2 = 4;
const LEAVES_PER_LEVEL2 = LEAVES_PER_LEVEL1 * LEVEL1_PER_LEVEL2;
const HALF_MASK = (1n << 256n) - 1n;

function assertWord(word: number, index: number): void {
  if (!Number.isInteger(word) || word < 0 || word > WORD_MASK) {
    throw new RangeError(`ROM word ${index} must be a 16-bit unsigned integer`);
  }
}

function normalizeWords(words: readonly number[]): number[] {
  if (words.length > ROM_WORDS) {
    throw new RangeError(`ROM contains ${words.length} words; maximum is ${ROM_WORDS}`);
  }
  const normalized = Array.from({ length: ROM_WORDS }, (_, index) => words[index] ?? 0);
  normalized.forEach(assertWord);
  return normalized;
}

function packHalf(words: readonly number[]): bigint {
  if (words.length !== WORDS_PER_HALF) {
    throw new RangeError(`ROM halves must contain exactly ${WORDS_PER_HALF} words`);
  }
  return words.reduce((packed, word) => (packed << 16n) | BigInt(word), 0n) & HALF_MASK;
}

function romLeafCell(words: readonly number[]): Cell {
  if (words.length !== WORDS_PER_LEAF) {
    throw new RangeError(`ROM leaves must contain exactly ${WORDS_PER_LEAF} words`);
  }
  return beginCell()
    .storeUint(packHalf(words.slice(0, WORDS_PER_HALF)), 256)
    .storeUint(packHalf(words.slice(WORDS_PER_HALF)), 256)
    .endCell();
}

function level1Cell(leaves: readonly Cell[]): Cell {
  if (leaves.length !== LEAVES_PER_LEVEL1) {
    throw new RangeError(`ROM level 1 nodes must contain exactly ${LEAVES_PER_LEVEL1} leaves`);
  }
  return beginCell()
    .storeRef(leaves[0]!)
    .storeRef(leaves[1]!)
    .storeRef(leaves[2]!)
    .storeRef(leaves[3]!)
    .endCell();
}

function level2Cell(level1Nodes: readonly Cell[]): Cell {
  if (level1Nodes.length !== LEVEL1_PER_LEVEL2) {
    throw new RangeError(`ROM level 2 nodes must contain exactly ${LEVEL1_PER_LEVEL2} children`);
  }
  return beginCell()
    .storeRef(level1Nodes[0]!)
    .storeRef(level1Nodes[1]!)
    .storeRef(level1Nodes[2]!)
    .storeRef(level1Nodes[3]!)
    .endCell();
}

/** Build the canonical 1024-word, 4-way ROM tree used by the Tolk contract. */
export function romRootCell(words: readonly number[] = []): Cell {
  const normalized = normalizeWords(words);
  const leaves = Array.from({ length: ROM_WORDS / WORDS_PER_LEAF }, (_, index) => {
    const start = index * WORDS_PER_LEAF;
    return romLeafCell(normalized.slice(start, start + WORDS_PER_LEAF));
  });
  const level1Nodes = Array.from({ length: leaves.length / LEAVES_PER_LEVEL1 }, (_, index) => {
    const start = index * LEAVES_PER_LEVEL1;
    return level1Cell(leaves.slice(start, start + LEAVES_PER_LEVEL1));
  });
  const level2Nodes = Array.from({ length: level1Nodes.length / LEVEL1_PER_LEVEL2 }, (_, index) => {
    const start = index * LEVEL1_PER_LEVEL2;
    return level2Cell(level1Nodes.slice(start, start + LEVEL1_PER_LEVEL2));
  });
  const zeroLeaf = romLeafCell(Array.from({ length: WORDS_PER_LEAF }, () => 0));
  const zeroLevel1 = level1Cell(Array.from({ length: LEAVES_PER_LEVEL1 }, () => zeroLeaf));
  const zeroLevel2 = level2Cell(Array.from({ length: LEVEL1_PER_LEVEL2 }, () => zeroLevel1));
  return beginCell()
    .storeRef(level2Nodes[0]!)
    .storeRef(level2Nodes[1]!)
    .storeRef(zeroLevel2)
    .storeRef(zeroLevel2)
    .endCell();
}

export function romRootHash(words: readonly number[] = []): bigint {
  return BigInt(`0x${romRootCell(words).hash().toString("hex")}`);
}

export function romWord(words: readonly number[], address: number): number {
  if (!Number.isInteger(address) || address < 0 || address >= ROM_WORDS) {
    throw new RangeError(`ROM address must be in 0..${ROM_WORDS - 1}`);
  }
  const normalized = normalizeWords(words);
  return normalized[address] ?? 0;
}

export function staticCommitmentCell(romHash: bigint): Cell {
  return beginCell()
    .storeUint(STATIC_COMMITMENT_NAMESPACE, 32)
    .storeUint(SCHEMA_VERSION, 16)
    .storeUint(ISA_VERSION, 16)
    .storeUint(romHash, 256)
    .endCell();
}

export function staticCommitment(words: readonly number[] = []): bigint {
  return BigInt(`0x${staticCommitmentCell(romRootHash(words)).hash().toString("hex")}`);
}

export const ROM_LAYOUT = {
  words: ROM_WORDS,
  wordsPerLeaf: WORDS_PER_LEAF,
  leavesPerLevel1: LEAVES_PER_LEVEL1,
  level1PerLevel2: LEVEL1_PER_LEVEL2,
  leavesPerLevel2: LEAVES_PER_LEVEL2,
} as const;
