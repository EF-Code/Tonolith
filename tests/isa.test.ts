import assert from "node:assert/strict";
import test from "node:test";
import { FLAG_CARRY, FLAG_ZERO, STATUS_HALTED, STATUS_RUNNING } from "../tools/isa/constants.js";
import { encodeInstruction, IsaError, Opcode, SysOp } from "../tools/isa/isa.js";
import { createInitialState, stateHash } from "../tools/isa/types.js";
import { executeBatch, executeInstruction } from "../tools/emulator/emulator.js";

test("instruction encoding enforces canonical operands", () => {
  assert.equal(encodeInstruction(Opcode.NOP), 0x0000);
  assert.equal(encodeInstruction(Opcode.LDI, 0x0f), 0x100f);
  assert.equal(encodeInstruction(Opcode.JMP, 1023), 0xc3ff);
  assert.throws(() => encodeInstruction(Opcode.NOP, 1), (error: unknown) => {
    return error instanceof IsaError && error.code === "NON_CANONICAL";
  });
  assert.throws(() => encodeInstruction(Opcode.LDI, 16), IsaError);
});

test("arithmetic flags and nibble wraparound are deterministic", () => {
  const rom = [
    encodeInstruction(Opcode.LDI, 15),
    encodeInstruction(Opcode.STR, 0),
    encodeInstruction(Opcode.LDI, 1),
    encodeInstruction(Opcode.ADD, 0),
    encodeInstruction(Opcode.SUB, 0),
  ];
  let state = createInitialState();
  state = executeInstruction(state, rom).state;
  state = executeInstruction(state, rom).state;
  state = executeInstruction(state, rom).state;
  state = executeInstruction(state, rom).state;
  assert.equal(state.accumulator, 0);
  assert.equal(state.flags & FLAG_CARRY, FLAG_CARRY);
  assert.equal(state.flags & FLAG_ZERO, FLAG_ZERO);
  state = executeInstruction(state, rom).state;
  assert.equal(state.accumulator, 1);
  assert.equal(state.flags & FLAG_CARRY, 0);
});

test("control flow, output, and halt are committed in instruction order", () => {
  const rom = [
    encodeInstruction(Opcode.LDI, 7),
    encodeInstruction(Opcode.SYS, SysOp.OUT),
    encodeInstruction(Opcode.SYS, SysOp.HALT),
  ];
  const result = executeBatch(createInitialState(), rom, 1);
  assert.equal(result.executed, 1);
  assert.equal(result.state.pc, 1);
  assert.equal(result.state.status, STATUS_RUNNING);
  const output = executeInstruction(result.state, rom);
  assert.equal(output.output?.value, 7);
  assert.equal(output.output?.outputIndex, 0n);
  const halted = executeInstruction(output.state, rom);
  assert.equal(halted.state.status, STATUS_HALTED);
  assert.throws(() => executeInstruction(halted.state, rom), /after HALT/);
});

test("state hashes are deterministic and change with architectural state", () => {
  const first = createInitialState();
  const second = createInitialState();
  assert.equal(stateHash(first), stateHash(second));
  second.accumulator = 1;
  assert.notEqual(stateHash(first), stateHash(second));
});
