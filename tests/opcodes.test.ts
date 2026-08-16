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

function runOne(word: number, configure?: (state: ReturnType<typeof createInitialState>) => void) {
  const state = createInitialState();
  configure?.(state);
  return executeInstruction(state, [word]);
}

test("NOP, immediate, register, and RAM instructions execute canonically", () => {
  const nop = runOne(encodeInstruction(Opcode.NOP));
  assert.equal(nop.state.pc, 1);
  assert.equal(nop.state.instructionCount, 1n);

  const immediate = runOne(encodeInstruction(Opcode.LDI, 0x0a));
  assert.equal(immediate.state.accumulator, 0x0a);
  assert.equal(immediate.state.flags & FLAG_ZERO, 0);

  const loadRegister = runOne(encodeInstruction(Opcode.LDR, 3), (state) => {
    state.registers[3] = 0x0c;
  });
  assert.equal(loadRegister.state.accumulator, 0x0c);

  const storeRegister = runOne(encodeInstruction(Opcode.STR, 3), (state) => {
    state.accumulator = 0x0d;
  });
  assert.equal(storeRegister.state.registers[3], 0x0d);

  const loadRam = runOne(encodeInstruction(Opcode.LDM, 0xa5), (state) => {
    state.ram[0xa5] = 0x0e;
  });
  assert.equal(loadRam.state.accumulator, 0x0e);

  const storeRam = runOne(encodeInstruction(Opcode.STM, 0xa5), (state) => {
    state.accumulator = 0x0f;
  });
  assert.equal(storeRam.state.ram[0xa5], 0x0f);
});

test("arithmetic and logical instructions update accumulator and flags", () => {
  const add = runOne(encodeInstruction(Opcode.ADD, 0), (state) => {
    state.accumulator = 0x0f;
    state.registers[0] = 1;
  });
  assert.equal(add.state.accumulator, 0);
  assert.equal(add.state.flags & FLAG_CARRY, FLAG_CARRY);
  assert.equal(add.state.flags & FLAG_ZERO, FLAG_ZERO);

  const adc = runOne(encodeInstruction(Opcode.ADC, 0), (state) => {
    state.accumulator = 0x0e;
    state.registers[0] = 1;
    state.flags = FLAG_CARRY;
  });
  assert.equal(adc.state.accumulator, 0);
  assert.equal(adc.state.flags & FLAG_CARRY, FLAG_CARRY);

  const subtractNoBorrow = runOne(encodeInstruction(Opcode.SUB, 0), (state) => {
    state.accumulator = 3;
    state.registers[0] = 2;
  });
  assert.equal(subtractNoBorrow.state.accumulator, 1);
  assert.equal(subtractNoBorrow.state.flags & FLAG_CARRY, FLAG_CARRY);

  const subtractBorrow = runOne(encodeInstruction(Opcode.SUB, 0), (state) => {
    state.accumulator = 2;
    state.registers[0] = 3;
  });
  assert.equal(subtractBorrow.state.accumulator, 0x0f);
  assert.equal(subtractBorrow.state.flags & FLAG_CARRY, 0);

  for (const [opcode, expected] of [
    [Opcode.AND, 0x08],
    [Opcode.OR, 0x0e],
    [Opcode.XOR, 0x06],
  ] as const) {
    const logical = runOne(encodeInstruction(opcode, 0), (state) => {
      state.accumulator = 0x0c;
      state.registers[0] = 0x0a;
      state.flags = FLAG_CARRY;
    });
    assert.equal(logical.state.accumulator, expected);
    assert.equal(logical.state.flags & FLAG_CARRY, 0);
  }
});

test("conditional and unconditional branches honor the current flags", () => {
  const jump = runOne(encodeInstruction(Opcode.JMP, 0x155));
  assert.equal(jump.state.pc, 0x155);

  const zeroTaken = runOne(encodeInstruction(Opcode.JZ, 0x155), (state) => {
    state.flags = FLAG_ZERO;
  });
  assert.equal(zeroTaken.state.pc, 0x155);

  const zeroNotTaken = runOne(encodeInstruction(Opcode.JZ, 0x155));
  assert.equal(zeroNotTaken.state.pc, 1);

  const carryTaken = runOne(encodeInstruction(Opcode.JC, 0x155), (state) => {
    state.flags = FLAG_CARRY;
  });
  assert.equal(carryTaken.state.pc, 0x155);

  const carryNotTaken = runOne(encodeInstruction(Opcode.JC, 0x155));
  assert.equal(carryNotTaken.state.pc, 1);
});

test("SYS operations cover halt, output, flags, and shifts", () => {
  const halt = runOne(encodeInstruction(Opcode.SYS, SysOp.HALT));
  assert.equal(halt.state.status, STATUS_HALTED);
  assert.equal(halt.state.instructionCount, 1n);

  const output = runOne(encodeInstruction(Opcode.SYS, SysOp.OUT), (state) => {
    state.accumulator = 7;
  });
  assert.equal(output.output?.value, 7);
  assert.equal(output.output?.outputIndex, 0n);
  assert.equal(output.state.outputCount, 1n);
  assert.equal(output.state.outputRegister, 7);

  const clearCarry = runOne(encodeInstruction(Opcode.SYS, SysOp.CLC), (state) => {
    state.flags = FLAG_CARRY;
  });
  assert.equal(clearCarry.state.flags & FLAG_CARRY, 0);

  const setCarry = runOne(encodeInstruction(Opcode.SYS, SysOp.STC));
  assert.equal(setCarry.state.flags & FLAG_CARRY, FLAG_CARRY);

  const not = runOne(encodeInstruction(Opcode.SYS, SysOp.NOT), (state) => {
    state.accumulator = 0x05;
  });
  assert.equal(not.state.accumulator, 0x0a);

  const shiftLeft = runOne(encodeInstruction(Opcode.SYS, SysOp.SHL), (state) => {
    state.accumulator = 0x09;
  });
  assert.equal(shiftLeft.state.accumulator, 2);
  assert.equal(shiftLeft.state.flags & FLAG_CARRY, FLAG_CARRY);

  const shiftRight = runOne(encodeInstruction(Opcode.SYS, SysOp.SHR), (state) => {
    state.accumulator = 0x09;
  });
  assert.equal(shiftRight.state.accumulator, 4);
  assert.equal(shiftRight.state.flags & FLAG_CARRY, FLAG_CARRY);

  const increment = runOne(encodeInstruction(Opcode.SYS, SysOp.INC), (state) => {
    state.accumulator = 0x0f;
  });
  assert.equal(increment.state.accumulator, 0);
  assert.equal(increment.state.flags & FLAG_CARRY, FLAG_CARRY);
  assert.equal(increment.state.flags & FLAG_ZERO, FLAG_ZERO);

  const decrement = runOne(encodeInstruction(Opcode.SYS, SysOp.DEC), (state) => {
    state.accumulator = 0;
  });
  assert.equal(decrement.state.accumulator, 0x0f);
  assert.equal(decrement.state.flags & FLAG_CARRY, 0);
});

test("invalid instructions and batch requests fail closed", () => {
  assert.throws(
    () => runOne(0x1011),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "NON_CANONICAL",
  );
  assert.throws(
    () => runOne(0xf009),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "INVALID_SYS_SUBOP",
  );
  assert.throws(
    () => runOne(0xf100),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "NON_CANONICAL",
  );
  assert.throws(
    () => executeBatch(createInitialState(), [encodeInstruction(Opcode.NOP)], 0),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "INVALID_STEP_COUNT",
  );
  assert.throws(
    () => executeBatch(createInitialState(), [encodeInstruction(Opcode.NOP)], 2),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "INVALID_STEP_COUNT",
  );
  assert.throws(
    () => executeInstruction(createInitialState(), []),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "ROM_BOUNDS",
  );
  const halted = createInitialState();
  halted.status = STATUS_HALTED;
  assert.throws(
    () => executeInstruction(halted, [encodeInstruction(Opcode.NOP)]),
    (error: unknown) => error instanceof CpuExecutionError && error.code === "HALTED",
  );
  const noOp = executeBatch(halted, [encodeInstruction(Opcode.NOP)], 1);
  assert.equal(noOp.executed, 0);
  assert.equal(noOp.state.status, STATUS_HALTED);
});

test("every opcode has a canonical 16-bit encoding", () => {
  for (const opcode of Object.values(Opcode).filter((value): value is Opcode => typeof value === "number")) {
    const operand = opcode === Opcode.SYS ? SysOp.OUT : 0;
    const word = encodeInstruction(opcode, operand);
    assert.deepEqual(decodeInstruction(word), { word, opcode, operand });
  }
});
