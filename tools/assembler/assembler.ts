import { readFile } from "node:fs/promises";
import { decodeInstruction, encodeInstruction, Opcode, SysOp } from "../isa/isa.js";

export interface AssemblyResult {
  words: number[];
  labels: Record<string, number>;
  sourceMap: Array<{ address: number; line: number; source: string }>;
}

export class AssemblyError extends Error {
  public readonly line: number | undefined;

  public constructor(message: string, line?: number) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = "AssemblyError";
    this.line = line;
  }
}

