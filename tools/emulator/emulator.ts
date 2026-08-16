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

export interface StepResult {
  state: CpuState;
  output?: CpuOutput;
}

export interface BatchResult {
  state: CpuState;
  outputs: CpuOutput[];
  executed: number;
}

export function executeInstruction(state: CpuState, rom: readonly number[]): StepResult {
  if (state.status === STATUS_HALTED) {
    throw new CpuExecutionError("HALTED", "cannot execute an instruction after HALT");
  }
  if (state.pc < 0 || state.pc >= rom.length) {
    throw new CpuExecutionError("ROM_BOUNDS", `PC ${state.pc} is outside the supplied ROM`);
  }

  const next = cloneState(state);
  let instruction: DecodedInstruction;
  try {
    instruction = decodeInstruction(rom[state.pc] ?? 0);
  } catch (error) {
    throw new CpuExecutionError(
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "INVALID_INSTRUCTION",
      error instanceof Error ? error.message : String(error),
    );
  }
  const nextPc = (next.pc + 1) & PC_MASK;
  next.pc = nextPc;
  let output: CpuOutput | undefined;

  switch (instruction.opcode) {
    case Opcode.NOP:
      break;
    case Opcode.LDI:
      next.accumulator = instruction.operand;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      break;
    case Opcode.LDR:
      next.accumulator = readRegister(next, instruction.operand);
      next.flags = setZeroFlag(next.flags, next.accumulator);
      break;
    case Opcode.STR:
      writeRegister(next, instruction.operand, next.accumulator);
      break;
    case Opcode.ADD:
      add(next, readRegister(next, instruction.operand), false);
      break;
    case Opcode.ADC:
      add(next, readRegister(next, instruction.operand), flagsContain(next.flags, FLAG_CARRY));
      break;
    case Opcode.SUB:
      subtract(next, readRegister(next, instruction.operand));
      break;
    case Opcode.AND:
      logical(next, next.accumulator & readRegister(next, instruction.operand));
      break;
    case Opcode.OR:
      logical(next, next.accumulator | readRegister(next, instruction.operand));
      break;
    case Opcode.XOR:
      logical(next, next.accumulator ^ readRegister(next, instruction.operand));
      break;
    case Opcode.LDM:
      next.accumulator = readRam(next, instruction.operand);
      next.flags = setZeroFlag(next.flags, next.accumulator);
      break;
    case Opcode.STM:
      writeRam(next, instruction.operand, next.accumulator);
      break;
    case Opcode.JMP:
      next.pc = instruction.operand;
      break;
    case Opcode.JZ:
      if (flagsContain(next.flags, FLAG_ZERO)) {
        next.pc = instruction.operand;
      }
      break;
    case Opcode.JC:
      if (flagsContain(next.flags, FLAG_CARRY)) {
        next.pc = instruction.operand;
      }
      break;
    case Opcode.SYS:
      output = executeSys(next, instruction);
      break;
    default:
      throw new CpuExecutionError("INVALID_OPCODE", `unsupported opcode ${instruction.opcode}`);
  }

  next.instructionCount += 1n;
  if (output !== undefined) {
    output = {
      ...output,
      instructionCount: next.instructionCount,
    };
    next.outputCount += 1n;
    next.outputCommitment = nextOutputCommitment(
      next.outputCommitment,
      output.outputIndex,
      next.instructionCount,
      output.value,
    );
    next.outputRegister = output.value;
    output.outputCommitment = next.outputCommitment;
  }

  return output === undefined ? { state: next } : { state: next, output };
}

export function executeBatch(
  state: CpuState,
  rom: readonly number[],
  maxInstructions: number,
): BatchResult {
  if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > MAX_STEPS_PER_ADVANCE) {
    throw new CpuExecutionError("INVALID_STEP_COUNT", "requested batch is outside the configured cap");
  }

  let current = cloneState(state);
  const outputs: CpuOutput[] = [];
  let executed = 0;
  while (executed < maxInstructions && current.status === STATUS_RUNNING) {
    const result = executeInstruction(current, rom);
    current = result.state;
    if (result.output !== undefined) {
      outputs.push(result.output);
    }
    executed += 1;
  }
  return { state: current, outputs, executed };
}

function add(state: CpuState, operand: number, includeCarry: boolean): void {
  const carry = includeCarry && flagsContain(state.flags, FLAG_CARRY) ? 1 : 0;
  const sum = state.accumulator + operand + carry;
  state.accumulator = sum & NIBBLE_MASK;
  state.flags = sum >= 16 ? state.flags | FLAG_CARRY : state.flags & ~FLAG_CARRY;
  state.flags = setZeroFlag(state.flags, state.accumulator);
}

function subtract(state: CpuState, operand: number): void {
  const before = state.accumulator;
  state.accumulator = (before - operand) & NIBBLE_MASK;
  state.flags = before >= operand ? state.flags | FLAG_CARRY : state.flags & ~FLAG_CARRY;
  state.flags = setZeroFlag(state.flags, state.accumulator);
}

