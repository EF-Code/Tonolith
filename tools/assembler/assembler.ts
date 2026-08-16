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

export async function assembleFile(path: string): Promise<AssemblyResult> {
  return assemble(await readFile(path, "utf8"));
}

export function assemble(source: string): AssemblyResult {
  const labels: Record<string, number> = {};
  const parsed: ParsedLine[] = [];
  let address = 0;

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const withoutComment = rawLine.replace(/[;#].*$/, "").trim();
    if (withoutComment.length === 0) {
      continue;
    }

    let remainder = withoutComment;
    const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(remainder);
    if (labelMatch !== null) {
      const label = labelMatch[1];
      if (label === undefined) {
        throw new AssemblyError("invalid label", lineNumber);
      }
      if (labels[label] !== undefined) {
        throw new AssemblyError(`duplicate label ${label}`, lineNumber);
      }
      labels[label] = address;
      remainder = remainder.slice(labelMatch[0].length).trim();
    }
    if (remainder.length === 0) {
      continue;
    }

    parsed.push({ lineNumber, source: remainder, address });
    address += 1;
  }

  const words = parsed.map((line) => {
    try {
      return parseInstruction(line.source, labels, line.lineNumber);
    } catch (error) {
      if (error instanceof AssemblyError) {
        throw error;
      }
      throw new AssemblyError(error instanceof Error ? error.message : String(error), line.lineNumber);
    }
  });
  return {
    words,
    labels,
    sourceMap: parsed.map(({ address: lineAddress, lineNumber, source }) => ({
      address: lineAddress,
      line: lineNumber,
      source,
    })),
  };
}

