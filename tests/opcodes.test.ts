import assert from "node:assert/strict";
import test from "node:test";
import {
  FLAG_CARRY,
  FLAG_ZERO,
  STATUS_HALTED,
  STATUS_RUNNING,
} from "../tools/isa/constants.js";
import {
  decodeInstruction,
  encodeInstruction,
  Opcode,
  SysOp,
} from "../tools/isa/isa.js";
import { CpuExecutionError, executeBatch, executeInstruction } from "../tools/emulator/emulator.js";
import { createInitialState } from "../tools/isa/types.js";

