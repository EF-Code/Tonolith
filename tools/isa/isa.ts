import {
  ADDRESS8_MASK,
  NIBBLE_MASK,
  PC_MASK,
  WORD_MASK,
} from "./constants.js";

export enum Opcode {
  NOP = 0x0,
  LDI = 0x1,
  LDR = 0x2,
  STR = 0x3,
  ADD = 0x4,
  ADC = 0x5,
  SUB = 0x6,
  AND = 0x7,
  OR = 0x8,
  XOR = 0x9,
  LDM = 0xa,
  STM = 0xb,
  JMP = 0xc,
  JZ = 0xd,
  JC = 0xe,
  SYS = 0xf,
}

export enum SysOp {
  HALT = 0x0,
  OUT = 0x1,
  CLC = 0x2,
  STC = 0x3,
  NOT = 0x4,
  SHL = 0x5,
  SHR = 0x6,
  INC = 0x7,
  DEC = 0x8,
}

export interface DecodedInstruction {
  word: number;
  opcode: Opcode;
  operand: number;
}

export class IsaError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "IsaError";
    this.code = code;
  }
}

export function encodeInstruction(opcode: Opcode, operand = 0): number {
  if (!Number.isInteger(operand) || operand < 0 || operand > 0xfff) {
    throw new IsaError("INVALID_OPERAND", "instruction operand must be a 12-bit unsigned integer");
  }

  switch (opcode) {
    case Opcode.NOP:
      requireOperand(opcode, operand === 0, "NOP operand must be zero");
      break;
    case Opcode.LDI:
      requireOperand(opcode, operand <= NIBBLE_MASK, "LDI immediate must be 4 bits");
      break;
    case Opcode.LDR:
    case Opcode.STR:
    case Opcode.ADD:
    case Opcode.ADC:
    case Opcode.SUB:
    case Opcode.AND:
    case Opcode.OR:
    case Opcode.XOR:
      requireOperand(opcode, operand <= NIBBLE_MASK, "register operand must be 4 bits");
      break;
    case Opcode.LDM:
    case Opcode.STM:
      requireOperand(opcode, operand <= ADDRESS8_MASK, "RAM address must be 8 bits");
      break;
    case Opcode.JMP:
    case Opcode.JZ:
    case Opcode.JC:
      requireOperand(opcode, operand <= PC_MASK, "jump target must be 10 bits");
      break;
    case Opcode.SYS:
      requireOperand(opcode, (operand & ~0x0f) === 0, "SYS operand must be 4 bits");
      if (operand > SysOp.DEC) {
        throw new IsaError("INVALID_SYS_SUBOP", `SYS suboperation 0x${operand.toString(16)} is reserved`);
      }
      break;
    default:
      throw new IsaError("INVALID_OPCODE", `unknown opcode: ${String(opcode)}`);
  }

  return ((opcode & NIBBLE_MASK) << 12) | operand;
}

export function decodeInstruction(word: number): DecodedInstruction {
  if (!Number.isInteger(word) || word < 0 || word > WORD_MASK) {
    throw new IsaError("INVALID_WORD", "instruction word must be a 16-bit unsigned integer");
  }

  const opcode = (word >>> 12) as Opcode;
  const operand = word & 0xfff;
  const canonicalWord = encodeInstruction(opcode, operand);
  if (canonicalWord !== word) {
    throw new IsaError("NON_CANONICAL", `instruction 0x${word.toString(16)} is not canonical`);
  }
  return { word, opcode, operand };
}

function requireOperand(opcode: Opcode, condition: boolean, message: string): void {
  if (!condition) {
    throw new IsaError("NON_CANONICAL", `${opcodeName(opcode)}: ${message}`);
  }
}

export function opcodeName(opcode: Opcode): string {
  return Opcode[opcode] ?? `OP_${opcode.toString(16).toUpperCase()}`;
}

export function sysName(op: SysOp): string {
  return SysOp[op] ?? `SYS_${op.toString(16).toUpperCase()}`;
}

