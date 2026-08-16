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

