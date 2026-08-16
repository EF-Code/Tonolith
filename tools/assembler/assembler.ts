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

export function disassembleWord(word: number): string {
  const decoded = decodeInstructionForDisplay(word);
  const { opcode, operand } = decoded;
  switch (opcode) {
    case Opcode.NOP:
      return "NOP";
    case Opcode.LDI:
      return `LDI ${formatImmediate(operand)}`;
    case Opcode.LDR:
      return `LDR R${operand}`;
    case Opcode.STR:
      return `STR R${operand}`;
    case Opcode.ADD:
      return `ADD R${operand}`;
    case Opcode.ADC:
      return `ADC R${operand}`;
    case Opcode.SUB:
      return `SUB R${operand}`;
    case Opcode.AND:
      return `AND R${operand}`;
    case Opcode.OR:
      return `OR R${operand}`;
    case Opcode.XOR:
      return `XOR R${operand}`;
    case Opcode.LDM:
      return `LDM ${formatImmediate(operand)}`;
    case Opcode.STM:
      return `STM ${formatImmediate(operand)}`;
    case Opcode.JMP:
      return `JMP ${formatImmediate(operand)}`;
    case Opcode.JZ:
      return `JZ ${formatImmediate(operand)}`;
    case Opcode.JC:
      return `JC ${formatImmediate(operand)}`;
    case Opcode.SYS:
      return SysOp[operand] === undefined ? `SYS ${formatImmediate(operand)}` : `SYS ${SysOp[operand]}`;
  }
}

function parseInstruction(source: string, labels: Record<string, number>, line: number): number {
  const parts = source.split(/[\s,]+/).filter(Boolean);
  const mnemonic = parts[0]?.toUpperCase();
  if (mnemonic === undefined) {
    throw new AssemblyError("missing instruction", line);
  }
  const operandText = parts[1];
  if (parts.length > 2) {
    throw new AssemblyError("expected at most one operand", line);
  }

  switch (mnemonic) {
    case "NOP":
      return parseNoOperand(mnemonic, operandText, Opcode.NOP, line);
    case "LDI":
      return encodeInstruction(Opcode.LDI, parseNumber(operandText, line));
    case "LDR":
      return encodeInstruction(Opcode.LDR, parseRegister(operandText, line));
    case "STR":
      return encodeInstruction(Opcode.STR, parseRegister(operandText, line));
    case "ADD":
      return encodeInstruction(Opcode.ADD, parseRegister(operandText, line));
    case "ADC":
      return encodeInstruction(Opcode.ADC, parseRegister(operandText, line));
    case "SUB":
      return encodeInstruction(Opcode.SUB, parseRegister(operandText, line));
    case "AND":
      return encodeInstruction(Opcode.AND, parseRegister(operandText, line));
    case "OR":
      return encodeInstruction(Opcode.OR, parseRegister(operandText, line));
    case "XOR":
      return encodeInstruction(Opcode.XOR, parseRegister(operandText, line));
    case "LDM":
      return encodeInstruction(Opcode.LDM, parseNumber(operandText, line));
    case "STM":
      return encodeInstruction(Opcode.STM, parseNumber(operandText, line));
    case "JMP":
      return encodeInstruction(Opcode.JMP, resolveTarget(operandText, labels, line));
    case "JZ":
      return encodeInstruction(Opcode.JZ, resolveTarget(operandText, labels, line));
    case "JC":
      return encodeInstruction(Opcode.JC, resolveTarget(operandText, labels, line));
    case "HALT":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.HALT);
    case "OUT":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.OUT);
    case "CLC":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.CLC);
    case "STC":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.STC);
    case "NOT":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.NOT);
    case "SHL":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.SHL);
    case "SHR":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.SHR);
    case "INC":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.INC);
    case "DEC":
      return parseNoOperand(mnemonic, operandText, Opcode.SYS, line, SysOp.DEC);
    default:
      throw new AssemblyError(`unknown mnemonic ${mnemonic}`, line);
  }
}

interface ParsedLine {
  lineNumber: number;
  source: string;
  address: number;
}

function parseNoOperand(
  mnemonic: string,
  operandText: string | undefined,
  opcode: Opcode,
  line: number,
  operand = 0,
): number {
  if (operandText !== undefined) {
    throw new AssemblyError(`${mnemonic} does not take an operand`, line);
  }
  return encodeInstruction(opcode, operand);
}

function parseRegister(text: string | undefined, line: number): number {
  if (text === undefined) {
    throw new AssemblyError("register operand is required", line);
  }
  const match = /^R(1[0-5]|[0-9])$/i.exec(text);
  if (match === null || match[1] === undefined) {
    throw new AssemblyError(`invalid register ${text}`, line);
  }
  return Number.parseInt(match[1], 10);
}

function parseNumber(text: string | undefined, line: number): number {
  if (text === undefined) {
    throw new AssemblyError("numeric operand is required", line);
  }
  if (!/^(?:0x[0-9a-f]+|0b[01]+|[0-9]+)$/i.test(text)) {
    throw new AssemblyError(`invalid numeric operand ${text}`, line);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new AssemblyError(`numeric operand is too large: ${text}`, line);
  }
  return value;
}

function resolveTarget(text: string | undefined, labels: Record<string, number>, line: number): number {
  if (text === undefined) {
    throw new AssemblyError("branch target is required", line);
  }
  if (/^(?:0x[0-9a-f]+|0b[01]+|[0-9]+)$/i.test(text)) {
    return parseNumber(text, line);
  }
  const target = labels[text];
  if (target === undefined) {
    throw new AssemblyError(`unknown label ${text}`, line);
  }
  return target;
}

function formatImmediate(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function decodeInstructionForDisplay(word: number) {
  try {
    return decodeInstruction(word);
  } catch (error) {
    throw new AssemblyError(error instanceof Error ? error.message : String(error));
  }
}
