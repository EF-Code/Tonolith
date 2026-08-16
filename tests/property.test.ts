import assert from "node:assert/strict";
import test from "node:test";

import {
  executeBatch,
  executeInstruction,
  CpuExecutionError,
} from "../tools/emulator/emulator.js";
import {
  FLAG_CARRY,
  FLAG_ZERO,
  STATUS_HALTED,
  STATUS_RUNNING,
} from "../tools/isa/constants.js";
import { encodeInstruction, Opcode, SysOp } from "../tools/isa/isa.js";
import {
  cloneState,
  createInitialState,
  nextOutputCommitment,
  type CpuState,
} from "../tools/isa/types.js";

let seed = 0x51f15e5d;

