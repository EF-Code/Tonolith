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
