import assert from "node:assert/strict";
import test from "node:test";
import { FLAG_CARRY, FLAG_ZERO, STATUS_HALTED, STATUS_RUNNING } from "../tools/isa/constants.js";
import { decodeInstruction, encodeInstruction, formatWord, IsaError, opcodeName, Opcode, sysName, SysOp } from "../tools/isa/isa.js";
import { assertNibble, assertRamAddress, assertRegister, createInitialState, coreStateCell, packRamPage, packRegisters, readRam, readRegister, setZeroFlag, stateHash, writeRam, writeRegister } from "../tools/isa/types.js";
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

test("legacy ISA and state helpers reject every invalid boundary", () => {
  for (const opcode of Object.values(Opcode).filter((value): value is Opcode => typeof value === "number")) {
    const operand = opcode === Opcode.LDI || opcode >= Opcode.LDR && opcode <= Opcode.XOR ? 15 : opcode === Opcode.LDM || opcode === Opcode.STM ? 255 : opcode >= Opcode.JMP && opcode <= Opcode.JC ? 1023 : opcode === Opcode.SYS ? SysOp.DEC : 0;
    assert.equal(decodeInstruction(encodeInstruction(opcode, operand)).opcode, opcode);
  }
  assert.throws(() => encodeInstruction(Opcode.NOP, Number.NaN), (error: unknown) => error instanceof IsaError && error.code === "INVALID_OPERAND");
  assert.throws(() => encodeInstruction(Opcode.NOP, -1), /12-bit/);
  assert.throws(() => encodeInstruction(Opcode.NOP, 0x1000), /12-bit/);
  assert.throws(() => encodeInstruction(99 as Opcode), (error: unknown) => error instanceof IsaError && error.code === "INVALID_OPCODE");
  assert.throws(() => encodeInstruction(Opcode.SYS, 9), (error: unknown) => error instanceof IsaError && error.code === "INVALID_SYS_SUBOP");
  assert.throws(() => decodeInstruction(-1), /16-bit/);
  assert.throws(() => decodeInstruction(0x10000), /16-bit/);
  assert.throws(() => decodeInstruction(0x1010), (error: unknown) => error instanceof IsaError && error.code === "NON_CANONICAL");
  assert.equal(opcodeName(99 as Opcode), "OP_63");
  assert.equal(sysName(99 as SysOp), "SYS_63");
  assert.equal(formatWord(0xab), "0x00ab");

  assert.throws(() => assertNibble(-1, "n"), /4-bit/);
  assert.throws(() => assertNibble(16, "n"), /4-bit/);
  assert.equal(setZeroFlag(FLAG_CARRY, 0), FLAG_CARRY | FLAG_ZERO);
  assert.equal(setZeroFlag(FLAG_CARRY | FLAG_ZERO, 1), FLAG_CARRY);
  assert.throws(() => assertRegister(-1), /register index/);
  assert.throws(() => assertRegister(16), /register index/);
  assert.throws(() => assertRamAddress(-1), /RAM address/);
  assert.throws(() => assertRamAddress(256), /RAM address/);
  const state = createInitialState();
  state.registers[0] = 3;
  state.ram[0] = 4;
  assert.equal(readRegister(state, 0), 3);
  assert.equal(readRam(state, 0), 4);
  writeRegister(state, 1, 5);
  writeRam(state, 1, 6);
  assert.equal(packRegisters(state.registers), 3n | (5n << 4n));
  assert.equal(packRamPage(state.ram, 0) & 0xffn, 4n | (6n << 4n));
  assert.throws(() => writeRegister(state, 0, 16), /4-bit/);
  assert.throws(() => writeRam(state, 0, 16), /4-bit/);
  assert.throws(() => packRegisters([]), /16 registers/);
  assert.throws(() => packRamPage(state.ram, 4), /page index/);
  assert.throws(() => coreStateCell({ ...state, flags: 4 }), /2-bit/);
  assert.throws(() => coreStateCell({ ...state, pc: 1024 }), /10-bit/);
  assert.throws(() => coreStateCell({ ...state, status: "bad" as never }), /invalid CPU status/);
  assert.throws(() => coreStateCell({ ...state, registers: [] }), /register file/);
});
