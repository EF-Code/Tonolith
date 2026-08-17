import {
  NIBBLE_MASK,
  PC_MASK,
  RAM_NIBBLES,
  ROM_WORDS,
  SYS,
  WORD_BITS,
} from "./constants.js";
import { Opcode, type DecodedInstruction, type InstructionShape, type V2SysOp } from "./types.js";

export class V2IsaError extends Error {
  public readonly code: "INVALID_WORD" | "INVALID_OPERAND" | "NON_CANONICAL" | "INVALID_SYS_SUBOP";

  public constructor(
    code: V2IsaError["code"],
    message: string,
  ) {
    super(message);
    this.name = "V2IsaError";
    this.code = code;
  }
}

export function encodeInstruction(opcode: Opcode, operand = 0): number {
  if (!Number.isInteger(operand) || operand < 0 || operand >= 1 << 12) {
    throw new V2IsaError("INVALID_OPERAND", "instruction operand must be 12-bit unsigned");
  }

  switch (opcode) {
    case Opcode.NOP:
      require(opcode, operand === 0, "NOP operand must be zero");
      break;
    case Opcode.LDI:
      require(opcode, operand <= NIBBLE_MASK, "LDI immediate must be 4 bits");
      break;
    case Opcode.LDR:
    case Opcode.STR:
    case Opcode.ADD:
    case Opcode.ADC:
    case Opcode.SUB:
    case Opcode.AND:
    case Opcode.OR:
    case Opcode.XOR:
      require(opcode, operand <= 0x0f, "register operand must be 4 bits");
      break;
    case Opcode.LDM:
    case Opcode.STM:
      require(opcode, operand < RAM_NIBBLES, "RAM address must be 8 bits");
      break;
    case Opcode.JMP:
    case Opcode.JZ:
    case Opcode.JC:
      require(opcode, operand < ROM_WORDS, "jump target must be 10 bits");
      break;
    case Opcode.SYS:
      validateSysOperand(operand);
      break;
    default:
      throw new V2IsaError("INVALID_OPERAND", `unknown opcode ${String(opcode)}`);
  }

  return ((opcode & NIBBLE_MASK) << (WORD_BITS - 4)) | operand;
}

export function decodeInstruction(word: number): DecodedInstruction {
  if (!Number.isInteger(word) || word < 0 || word >= 1 << WORD_BITS) {
    throw new V2IsaError("INVALID_WORD", "instruction word must be 16-bit unsigned");
  }

  const opcode = (word >>> (WORD_BITS - 4)) as Opcode;
  const operand = word & 0x0fff;
  const canonical = encodeInstruction(opcode, operand);
  if (canonical !== word) {
    throw new V2IsaError("NON_CANONICAL", `instruction 0x${word.toString(16).padStart(4, "0")} is non-canonical`);
  }

  if (opcode !== Opcode.SYS) {
    return { word, opcode, operand };
  }

  const sysSubop = (operand & 0x0f) as V2SysOp;
  if (sysSubop === SYS.IN || sysSubop === SYS.OUTP) {
    return { word, opcode, operand, sysSubop, port: operand >>> 4 };
  }
  if (sysSubop === SYS.TRAP) {
    return { word, opcode, operand, sysSubop, trapCode: operand >>> 4 };
  }
  return { word, opcode, operand, sysSubop };
}

export function encodeShape(shape: InstructionShape): number {
  return encodeInstruction(shape.opcode, shape.operand ?? 0);
}

export function encodePortInstruction(op: typeof SYS.IN | typeof SYS.OUTP, port: number): number {
  requirePort(port);
  return encodeInstruction(Opcode.SYS, (port << 4) | op);
}

export function encodeTrap(code: number): number {
  if (!Number.isInteger(code) || code < 0 || code > 0xff) {
    throw new V2IsaError("INVALID_OPERAND", "TRAP code must be an unsigned 8-bit value");
  }
  return encodeInstruction(Opcode.SYS, (code << 4) | SYS.TRAP);
}

export function disassembleWord(word: number): string {
  const instruction = decodeInstruction(word);
  if (instruction.opcode === Opcode.NOP) return "NOP";
  if (instruction.opcode === Opcode.LDI) return `LDI 0x${instruction.operand.toString(16).toUpperCase()}`;
  if (instruction.opcode >= Opcode.LDR && instruction.opcode <= Opcode.XOR) {
    return `${Opcode[instruction.opcode]} R${instruction.operand}`;
  }
  if (instruction.opcode === Opcode.LDM || instruction.opcode === Opcode.STM) {
    return `${Opcode[instruction.opcode]} 0x${instruction.operand.toString(16).toUpperCase()}`;
  }
  if (instruction.opcode >= Opcode.JMP && instruction.opcode <= Opcode.JC) {
    return `${Opcode[instruction.opcode]} 0x${instruction.operand.toString(16).toUpperCase()}`;
  }
  if (instruction.sysSubop === SYS.IN || instruction.sysSubop === SYS.OUTP) {
    return `${instruction.sysSubop === SYS.IN ? "IN" : "OUTP"} ${instruction.port}`;
  }
  if (instruction.sysSubop === SYS.TRAP) return `TRAP 0x${instruction.trapCode!.toString(16).toUpperCase()}`;
  return `SYS ${sysName(instruction.sysSubop!)}`;
}

export function sysName(op: V2SysOp): string {
  const entry = Object.entries(SYS).find(([, value]) => value === op);
  return entry?.[0] ?? `0x${op.toString(16).toUpperCase()}`;
}

function validateSysOperand(operand: number): void {
  const subop = operand & 0x0f;
  if (subop <= SYS.DEC || subop === SYS.YIELD) {
    require(Opcode.SYS, operand === subop, "legacy SYS and YIELD operands must have zero argument bits");
    return;
  }
  if (subop === SYS.IN || subop === SYS.OUTP) {
    requirePort(operand >>> 4);
    return;
  }
  if (subop === SYS.TRAP) {
    return;
  }
  throw new V2IsaError("INVALID_SYS_SUBOP", `reserved SYS suboperation 0x${subop.toString(16)}`);
}

function requirePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port >= 16) {
    throw new V2IsaError("INVALID_OPERAND", "port must be in 0..15");
  }
}

function require(opcode: Opcode, condition: boolean, message: string): void {
  if (!condition) {
    throw new V2IsaError("NON_CANONICAL", `${Opcode[opcode]}: ${message}`);
  }
}
