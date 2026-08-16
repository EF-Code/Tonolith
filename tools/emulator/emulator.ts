import {
  FLAG_CARRY,
  FLAG_ZERO,
  MAX_STEPS_PER_ADVANCE,
  NIBBLE_MASK,
  PC_MASK,
  STATUS_HALTED,
  STATUS_RUNNING,
} from "../isa/constants.js";
import {
  decodeInstruction,
  Opcode,
  SysOp,
  type DecodedInstruction,
} from "../isa/isa.js";
import {
  assertNibble,
  cloneState,
  flagsContain,
  nextOutputCommitment,
  readRam,
  readRegister,
  setZeroFlag,
  writeRam,
  writeRegister,
  type CpuOutput,
  type CpuState,
} from "../isa/types.js";

export class CpuExecutionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "CpuExecutionError";
    this.code = code;
  }
}

