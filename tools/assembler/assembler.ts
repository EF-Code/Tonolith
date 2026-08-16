import { readFile } from "node:fs/promises";
import { decodeInstruction, encodeInstruction, Opcode, SysOp } from "../isa/isa.js";

