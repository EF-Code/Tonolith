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

