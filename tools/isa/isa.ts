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

