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
