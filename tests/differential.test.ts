import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { executeInstruction } from "../tools/emulator/emulator.js";
import { romRootHash, staticCommitment } from "../tools/rom/rom.js";
import { createInitialState, stateHash } from "../tools/isa/types.js";

