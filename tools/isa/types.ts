import { beginCell, type Cell } from "@ton/core";
import {
  FLAG_CARRY,
  FLAG_ZERO,
  NIBBLE_MASK,
  OUTPUT_COMMITMENT_DOMAIN,
  RAM_SIZE,
  REGISTER_COUNT,
  STATUS_HALTED,
  STATUS_RUNNING,
} from "./constants.js";

export type CpuStatus = typeof STATUS_RUNNING | typeof STATUS_HALTED;

export interface CpuState {
  advanceCount: bigint;
  instructionCount: bigint;
  outputCount: bigint;
  pc: number;
  accumulator: number;
  flags: number;
  status: CpuStatus;
  outputRegister: number;
  registers: number[];
  outputCommitment: bigint;
  ram: Uint8Array;
}

export interface CpuOutput {
  outputIndex: bigint;
  instructionCount: bigint;
  value: number;
  outputCommitment: bigint;
}

export function createInitialState(): CpuState {
  return {
    advanceCount: 0n,
    instructionCount: 0n,
    outputCount: 0n,
    pc: 0,
    accumulator: 0,
    flags: 0,
    status: STATUS_RUNNING,
    outputRegister: 0,
    registers: Array.from({ length: REGISTER_COUNT }, () => 0),
    outputCommitment: 0n,
    ram: new Uint8Array(RAM_SIZE),
  };
}

export function cloneState(state: CpuState): CpuState {
  return {
    ...state,
    registers: [...state.registers],
    ram: state.ram.slice(),
  };
}

export function assertNibble(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > NIBBLE_MASK) {
    throw new RangeError(`${field} must be an unsigned 4-bit value`);
  }
}

export function setZeroFlag(flags: number, value: number): number {
  assertNibble(value, "value");
  return value === 0 ? flags | FLAG_ZERO : flags & ~FLAG_ZERO;
}

export function readRegister(state: CpuState, index: number): number {
  assertRegister(index);
  return state.registers[index] ?? 0;
}

export function writeRegister(state: CpuState, index: number, value: number): void {
  assertRegister(index);
  assertNibble(value, "register value");
  state.registers[index] = value;
}

export function assertRamAddress(address: number): void {
  if (!Number.isInteger(address) || address < 0 || address >= RAM_SIZE) {
    throw new RangeError(`RAM address must be in 0..${RAM_SIZE - 1}`);
  }
}

export function assertRegister(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= REGISTER_COUNT) {
    throw new RangeError(`register index must be in 0..${REGISTER_COUNT - 1}`);
  }
}

export function readRam(state: CpuState, address: number): number {
  assertRamAddress(address);
  return state.ram[address] ?? 0;
}

export function writeRam(state: CpuState, address: number, value: number): void {
  assertRamAddress(address);
  assertNibble(value, "RAM value");
  state.ram[address] = value;
}

export function packRamPage(ram: Uint8Array, pageIndex: number): bigint {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= 4) {
    throw new RangeError("RAM page index must be in 0..3");
  }

  let packed = 0n;
  const start = pageIndex * 64;
  for (let index = 0; index < 64; index += 1) {
    const value = ram[start + index] ?? 0;
    assertNibble(value, "RAM value");
    packed |= BigInt(value) << BigInt(index * 4);
  }
  return packed;
}

export function ramPageCell(ram: Uint8Array, pageIndex: number): Cell {
  return beginCell().storeUint(packRamPage(ram, pageIndex), 256).endCell();
}

export function ramRootCell(ram: Uint8Array): Cell {
  return beginCell()
    .storeRef(ramPageCell(ram, 0))
    .storeRef(ramPageCell(ram, 1))
    .storeRef(ramPageCell(ram, 2))
    .storeRef(ramPageCell(ram, 3))
    .endCell();
}

export function coreStateCell(state: CpuState): Cell {
  assertNibble(state.accumulator, "accumulator");
  assertNibble(state.outputRegister, "output register");
  if (state.flags < 0 || state.flags > 3) {
    throw new RangeError("flags must be a 2-bit value");
  }
  if (state.pc < 0 || state.pc > 1023) {
    throw new RangeError("PC must be a 10-bit value");
  }
  if (state.status !== STATUS_RUNNING && state.status !== STATUS_HALTED) {
    throw new RangeError("invalid CPU status");
  }
  if (state.registers.length !== REGISTER_COUNT) {
    throw new RangeError("register file must contain 16 registers");
  }
  for (const value of state.registers) {
    assertNibble(value, "register value");
  }

  return beginCell()
    .storeUint(state.advanceCount, 64)
    .storeUint(state.instructionCount, 64)
    .storeUint(state.outputCount, 64)
    .storeUint(state.pc, 10)
    .storeUint(state.accumulator, 4)
    .storeUint(state.flags, 2)
    .storeUint(state.status === STATUS_HALTED ? 1 : 0, 1)
    .storeUint(state.outputRegister, 4)
    .storeUint(packRegisters(state.registers), 64)
    .storeUint(state.outputCommitment, 256)
    .storeRef(ramRootCell(state.ram))
    .endCell();
}

export function stateHash(state: CpuState): string {
  return coreStateCell(state).hash().toString("hex");
}

export function packRegisters(registers: readonly number[]): bigint {
  if (registers.length !== REGISTER_COUNT) {
    throw new RangeError("register file must contain 16 registers");
  }

  let packed = 0n;
  registers.forEach((value, index) => {
    assertNibble(value, "register value");
    packed |= BigInt(value) << BigInt(index * 4);
  });
  return packed;
}

export function outputCommitmentCell(
  previousCommitment: bigint,
  outputIndex: bigint,
  instructionCount: bigint,
  value: number,
): Cell {
  assertNibble(value, "output value");
  return beginCell()
    .storeUint(OUTPUT_COMMITMENT_DOMAIN, 32)
    .storeUint(previousCommitment, 256)
    .storeUint(outputIndex, 64)
    .storeUint(instructionCount, 64)
    .storeUint(value, 4)
    .endCell();
}

