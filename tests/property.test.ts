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

function randomCanonicalWord(): { opcode: Opcode; operand: number; word: number } {
  const opcode = (randomUint32() & 0x0f) as Opcode;
  let operand = 0;
  if (opcode === Opcode.LDI || opcode >= Opcode.LDR && opcode <= Opcode.XOR) {
    operand = randomUint32() & 0x0f;
  } else if (opcode === Opcode.LDM || opcode === Opcode.STM) {
    operand = randomUint32() & 0xff;
  } else if (opcode >= Opcode.JMP && opcode <= Opcode.JC) {
    operand = randomUint32() & 0x3ff;
  } else if (opcode === Opcode.SYS) {
    operand = randomUint32() % (SysOp.DEC + 1);
  }
  return { opcode, operand, word: encodeInstruction(opcode, operand) };
}

function assertStateBounds(state: CpuState): void {
  assert.ok(state.pc >= 0 && state.pc <= 1023);
  assert.ok(state.accumulator >= 0 && state.accumulator <= 15);
  assert.ok(state.flags >= 0 && state.flags <= 3);
  assert.ok(state.outputRegister >= 0 && state.outputRegister <= 15);
  assert.ok(state.registers.every((value) => value >= 0 && value <= 15));
  assert.ok([...state.ram].every((value) => value >= 0 && value <= 15));
  assert.ok(state.status === STATUS_RUNNING || state.status === STATUS_HALTED);
}

test("deterministic property traces preserve architectural invariants", () => {
  for (let iteration = 0; iteration < 1_024; iteration += 1) {
    const { opcode, operand, word } = randomCanonicalWord();
    const before = randomState();
    before.pc = 0;
    const input = cloneState(before);
    const result = executeInstruction(input, [word]);
    const next = result.state;

    assert.deepStrictEqual(input, before, `input mutated at iteration ${iteration}`);
    assert.equal(next.instructionCount, before.instructionCount + 1n);
    assert.equal(next.advanceCount, before.advanceCount);
    assert.equal(next.outputCount >= before.outputCount, true);
    assertStateBounds(next);

    const sequentialPc = 1;
    const shouldJump =
      opcode === Opcode.JMP ||
      opcode === Opcode.JZ && (before.flags & FLAG_ZERO) !== 0 ||
      opcode === Opcode.JC && (before.flags & FLAG_CARRY) !== 0;
    assert.equal(next.pc, shouldJump ? operand : sequentialPc);

    if (opcode === Opcode.SYS && operand === SysOp.HALT) {
      assert.equal(next.status, STATUS_HALTED);
    }
    if (opcode === Opcode.SYS && operand === SysOp.OUT) {
      assert.ok(result.output);
      assert.equal(result.output?.value, before.accumulator);
      assert.equal(result.output?.instructionCount, next.instructionCount);
      assert.equal(
        result.output?.outputCommitment,
        nextOutputCommitment(
          before.outputCommitment,
          before.outputCount,
          next.instructionCount,
          before.accumulator,
        ),
      );
      assert.equal(next.outputCount, before.outputCount + 1n);
    } else {
      assert.equal(result.output, undefined);
      assert.equal(next.outputCount, before.outputCount);
    }
  }
});

test("malformed words fail closed without mutating the input state", () => {
  const malformedWords = [0x0001, 0x1010, 0x2010, 0xa100, 0xc400, 0xf010, 0xf009];
  for (const word of malformedWords) {
    const state = randomState();
    state.pc = 0;
    const before = cloneState(state);
    assert.throws(
      () => executeInstruction(state, [word]),
      (error: unknown) =>
        error instanceof CpuExecutionError &&
        (error.code === "NON_CANONICAL" || error.code === "INVALID_SYS_SUBOP"),
      `word 0x${word.toString(16)} unexpectedly executed`,
    );
    assert.deepStrictEqual(state, before);
  }
});

test("batch cap rejects zero and over-cap requests", () => {
  for (const requested of [0, 2, Number.NaN, 1.5]) {
    assert.throws(
      () => executeBatch(createInitialState(), [0], requested),
      (error: unknown) => error instanceof CpuExecutionError && error.code === "INVALID_STEP_COUNT",
    );
  }
});
