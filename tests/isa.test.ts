import assert from "node:assert/strict";
import test from "node:test";
import { FLAG_CARRY, FLAG_ZERO, STATUS_HALTED, STATUS_RUNNING } from "../tools/isa/constants.js";
import { encodeInstruction, IsaError, Opcode, SysOp } from "../tools/isa/isa.js";
