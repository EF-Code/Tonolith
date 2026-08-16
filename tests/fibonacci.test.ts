import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assemble } from "../tools/assembler/assembler.js";
import { executeInstruction } from "../tools/emulator/emulator.js";
import { romRootHash, staticCommitment } from "../tools/rom/rom.js";
