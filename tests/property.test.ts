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

function randomUint32(): number {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return seed;
}

function randomState(): CpuState {
  const state = createInitialState();
  state.accumulator = randomUint32() & 0x0f;
  state.flags = randomUint32() & 0x03;
  state.outputRegister = randomUint32() & 0x0f;
  state.registers = state.registers.map(() => randomUint32() & 0x0f);
  state.ram = state.ram.map(() => randomUint32() & 0x0f);
  state.advanceCount = BigInt(randomUint32());
  state.instructionCount = BigInt(randomUint32());
  state.outputCount = BigInt(randomUint32());
  state.outputCommitment = BigInt(randomUint32()) << 224n | BigInt(randomUint32());
  return state;
}

