import { SYS } from "./constants.js";

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

export type LegacySysOp =
  | typeof SYS.HALT
  | typeof SYS.OUT
  | typeof SYS.CLC
  | typeof SYS.STC
  | typeof SYS.NOT
  | typeof SYS.SHL
  | typeof SYS.SHR
  | typeof SYS.INC
  | typeof SYS.DEC;

export type V2SysOp =
  | LegacySysOp
  | typeof SYS.IN
  | typeof SYS.OUTP
  | typeof SYS.YIELD
  | typeof SYS.TRAP;

export interface DecodedInstruction {
  readonly word: number;
  readonly opcode: Opcode;
  readonly operand: number;
  readonly sysSubop?: V2SysOp;
  readonly port?: number;
  readonly trapCode?: number;
}

export interface InstructionShape {
  readonly opcode: Opcode;
  readonly operand?: number;
}
