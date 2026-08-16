import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { decodeInstruction, encodeInstruction, encodePortInstruction, encodeTrap, V2IsaError } from "../../isa/src/codec.js";
import { Opcode } from "../../isa/src/types.js";
import { RAM_NIBBLES, ROM_WORDS, SYS } from "../../isa/src/constants.js";

export interface V2SourceMapEntry {
  readonly address: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly source: string;
}

export interface V2AssemblyResult {
  readonly words: number[];
  readonly ram: Uint8Array;
  readonly entryPc: number;
  readonly labels: Readonly<Record<string, number>>;
  readonly exports: Readonly<Record<string, number>>;
  readonly sourceMap: readonly V2SourceMapEntry[];
  readonly canonicalSource: string;
}

export interface AssembleFileOptions {
  readonly rootDir?: string;
}

interface SourceLine {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

interface PendingInstruction {
  readonly address: number;
  readonly source: SourceLine;
  readonly text: string;
}

export class V2AssemblyError extends Error {
  public readonly code: string;
  public readonly file: string;
  public readonly line: number;
  public readonly column: number;

  public constructor(code: string, message: string, source: SourceLine, column = 1) {
    super(`${source.file}:${source.line}:${column}: ${message}`);
    this.name = "V2AssemblyError";
    this.code = code;
    this.file = source.file;
    this.line = source.line;
    this.column = column;
  }
}

export function assembleV2(source: string, file = "program.tasm"): V2AssemblyResult {
  return assembleLines(source.split(/\r?\n/).map((text, index) => ({ file, line: index + 1, text })));
}

export function assembleFileV2(entryFile: string, options: AssembleFileOptions = {}): V2AssemblyResult {
  const rootDir = resolve(options.rootDir ?? dirname(resolve(entryFile)));
  const lines = expandFile(resolve(entryFile), rootDir, new Set<string>());
  return assembleLines(lines);
}

function assembleLines(lines: readonly SourceLine[]): V2AssemblyResult {
  const words = Array.from({ length: ROM_WORDS }, () => 0);
  const ram = new Uint8Array(RAM_NIBBLES);
  const claimedRom = new Set<number>();
  const claimedRam = new Set<number>();
  const labels: Record<string, number> = {};
  const pending: PendingInstruction[] = [];
  const exportedNames: string[] = [];
  let romCursor = 0;
  let entryToken: string | undefined;

  for (const source of lines) {
    const stripped = source.text.replace(/[;#].*$/, "").trim();
    if (stripped.length === 0) continue;
    let remainder = stripped;
    const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(remainder);
    if (labelMatch !== null) {
      const label = labelMatch[1];
      if (label === undefined) throw new V2AssemblyError("INVALID_LABEL", "label is missing", source);
      if (labels[label] !== undefined) throw new V2AssemblyError("DUPLICATE_SYMBOL", `duplicate symbol ${label}`, source);
      labels[label] = romCursor;
      remainder = remainder.slice(labelMatch[0].length).trim();
    }
    if (remainder.length === 0) continue;
    const parts = splitParts(remainder);
    const directive = parts[0]?.toLowerCase();
    if (directive === undefined) throw new V2AssemblyError("INVALID_LINE", "empty statement", source);

    switch (directive) {
      case ".org":
        requireParts(parts, 2, source);
        romCursor = parseRange(parts[1], 0, ROM_WORDS - 1, source, "ROM origin");
        break;
      case ".word": {
        requireParts(parts, 2, source);
        const word = parseRange(parts[1], 0, 0xffff, source, "word");
        claimRom(claimedRom, romCursor, source);
        words[romCursor] = assertCanonicalWord(word, source);
        pending.push({ address: romCursor, source, text: remainder });
        romCursor += 1;
        break;
      }
      case ".nibble":
      case ".ram": {
        requireParts(parts, 3, source);
        const address = parseRange(parts[1], 0, RAM_NIBBLES - 1, source, "RAM address");
        const value = parseRange(parts[2], 0, 0xf, source, "RAM nibble");
        if (claimedRam.has(address)) throw new V2AssemblyError("OVERLAPPING_SEGMENT", `RAM address ${address} is already initialized`, source);
        claimedRam.add(address);
        ram[address] = value;
        break;
      }
      case ".entry":
        requireParts(parts, 2, source);
        if (entryToken !== undefined) throw new V2AssemblyError("DUPLICATE_ENTRY", "entry point is already declared", source);
        entryToken = parts[1];
        break;
      case ".export":
        requireParts(parts, 2, source);
        if (exportedNames.includes(parts[1]!)) throw new V2AssemblyError("DUPLICATE_SYMBOL", `duplicate export ${parts[1]}`, source);
        exportedNames.push(parts[1]!);
        break;
      case ".include":
        throw new V2AssemblyError("INCLUDE_REQUIRES_FILE", ".include requires assembleFileV2 so its root can be constrained", source);
      default:
        claimRom(claimedRom, romCursor, source);
        pending.push({ address: romCursor, source, text: remainder });
        romCursor += 1;
        break;
    }
  }

  const sourceMap: V2SourceMapEntry[] = [];
  for (const item of pending) {
    const word = item.text.toLowerCase().startsWith(".word")
      ? words[item.address]!
      : parseInstruction(item.text, labels, item.source);
    words[item.address] = assertCanonicalWord(word, item.source);
    sourceMap.push({
      address: item.address,
      file: item.source.file,
      line: item.source.line,
      column: Math.max(1, item.source.text.indexOf(item.text) + 1),
      source: item.text,
    });
  }

  const entryPc = entryToken === undefined ? 0 : resolveSymbolOrNumber(entryToken, labels, 0, ROM_WORDS - 1, lines[0] ?? { file: "program.tasm", line: 1, text: "" }, "entry point");
  if (!claimedRom.has(entryPc)) {
    throw new V2AssemblyError("INVALID_ENTRY", `entry point ${entryPc} does not reference an occupied ROM word`, lines[0] ?? { file: "program.tasm", line: 1, text: "" });
  }
  const exports: Record<string, number> = {};
  for (const name of exportedNames) {
    const value = labels[name];
    if (value === undefined) throw new V2AssemblyError("UNKNOWN_SYMBOL", `unknown export ${name}`, lines[0] ?? { file: "program.tasm", line: 1, text: "" });
    exports[name] = value;
  }
  return {
    words,
    ram,
    entryPc,
    labels,
    exports,
    sourceMap,
    canonicalSource: lines.map((line) => `${line.file}\n${line.line}\n${line.text.replace(/\r$/, "")}`).join("\n"),
  };
}

function parseInstruction(text: string, labels: Readonly<Record<string, number>>, source: SourceLine): number {
  const parts = splitParts(text);
  const mnemonic = parts[0]?.toUpperCase();
  if (mnemonic === undefined) throw new V2AssemblyError("INVALID_INSTRUCTION", "missing mnemonic", source);
  const operand = parts[1];
  if (parts.length > 2) throw new V2AssemblyError("INVALID_INSTRUCTION", "expected at most one operand", source);
  try {
    switch (mnemonic) {
      case "NOP": return noOperand(mnemonic, operand, Opcode.NOP, source);
      case "LDI": return encodeInstruction(Opcode.LDI, parseRange(operand, 0, 0xf, source, "immediate"));
      case "LDR": return encodeInstruction(Opcode.LDR, parseRegister(operand, source));
      case "STR": return encodeInstruction(Opcode.STR, parseRegister(operand, source));
      case "ADD": return encodeInstruction(Opcode.ADD, parseRegister(operand, source));
      case "ADC": return encodeInstruction(Opcode.ADC, parseRegister(operand, source));
      case "SUB": return encodeInstruction(Opcode.SUB, parseRegister(operand, source));
      case "AND": return encodeInstruction(Opcode.AND, parseRegister(operand, source));
      case "OR": return encodeInstruction(Opcode.OR, parseRegister(operand, source));
      case "XOR": return encodeInstruction(Opcode.XOR, parseRegister(operand, source));
      case "LDM": return encodeInstruction(Opcode.LDM, parseRange(operand, 0, 0xff, source, "RAM address"));
      case "STM": return encodeInstruction(Opcode.STM, parseRange(operand, 0, 0xff, source, "RAM address"));
      case "JMP": return encodeInstruction(Opcode.JMP, resolveSymbolOrNumber(operand, labels, 0, ROM_WORDS - 1, source, "jump target"));
      case "JZ": return encodeInstruction(Opcode.JZ, resolveSymbolOrNumber(operand, labels, 0, ROM_WORDS - 1, source, "jump target"));
      case "JC": return encodeInstruction(Opcode.JC, resolveSymbolOrNumber(operand, labels, 0, ROM_WORDS - 1, source, "jump target"));
      case "HALT": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.HALT);
      case "OUT": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.OUT);
      case "CLC": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.CLC);
      case "STC": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.STC);
      case "NOT": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.NOT);
      case "SHL": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.SHL);
      case "SHR": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.SHR);
      case "INC": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.INC);
      case "DEC": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.DEC);
      case "IN": return encodePortInstruction(SYS.IN, parseRange(operand, 0, 15, source, "input port"));
      case "OUTP": return encodePortInstruction(SYS.OUTP, parseRange(operand, 0, 15, source, "output port"));
      case "YIELD": return noOperand(mnemonic, operand, Opcode.SYS, source, SYS.YIELD);
      case "TRAP": return encodeTrap(parseRange(operand, 0, 0xff, source, "trap code"));
      case "SYS": return parseSys(operand, source);
      default: throw new V2AssemblyError("UNKNOWN_MNEMONIC", `unknown mnemonic ${mnemonic}`, source);
    }
  } catch (error) {
    if (error instanceof V2AssemblyError) throw error;
    if (error instanceof V2IsaError) throw new V2AssemblyError(error.code, error.message, source);
    throw new V2AssemblyError("INVALID_INSTRUCTION", error instanceof Error ? error.message : String(error), source);
  }
}

function parseSys(operand: string | undefined, source: SourceLine): number {
  if (operand === undefined) throw new V2AssemblyError("MISSING_OPERAND", "SYS requires a suboperation", source);
  const named: Record<string, number> = {
    HALT: SYS.HALT,
    OUT: SYS.OUT,
    CLC: SYS.CLC,
    STC: SYS.STC,
    NOT: SYS.NOT,
    SHL: SYS.SHL,
    SHR: SYS.SHR,
    INC: SYS.INC,
    DEC: SYS.DEC,
    YIELD: SYS.YIELD,
  };
  if (named[operand.toUpperCase()] !== undefined) return encodeInstruction(Opcode.SYS, named[operand.toUpperCase()]!);
  return encodeInstruction(Opcode.SYS, parseRange(operand, 0, 0xfff, source, "SYS operand"));
}

function noOperand(mnemonic: string, operand: string | undefined, opcode: Opcode, source: SourceLine, value = 0): number {
  if (operand !== undefined) throw new V2AssemblyError("UNEXPECTED_OPERAND", `${mnemonic} does not take an operand`, source);
  return encodeInstruction(opcode, value);
}

function parseRegister(value: string | undefined, source: SourceLine): number {
  if (value === undefined) throw new V2AssemblyError("MISSING_OPERAND", "register is required", source);
  const match = /^R(1[0-5]|[0-9])$/i.exec(value);
  if (match === null || match[1] === undefined) throw new V2AssemblyError("INVALID_REGISTER", `invalid register ${value}`, source);
  return Number(match[1]);
}

function resolveSymbolOrNumber(value: string | undefined, labels: Readonly<Record<string, number>>, minimum: number, maximum: number, source: SourceLine, field: string): number {
  if (value === undefined) throw new V2AssemblyError("MISSING_OPERAND", `${field} is required`, source);
  if (/^(?:0x[0-9a-f]+|0b[01]+|[0-9]+)$/i.test(value)) return parseRange(value, minimum, maximum, source, field);
  const resolved = labels[value];
  if (resolved === undefined) throw new V2AssemblyError("UNKNOWN_SYMBOL", `unknown symbol ${value}`, source);
  if (resolved < minimum || resolved > maximum) throw new V2AssemblyError("OUT_OF_RANGE", `${field} is outside ${minimum}..${maximum}`, source);
  return resolved;
}

function parseRange(value: string | undefined, minimum: number, maximum: number, source: SourceLine, field: string): number {
  if (value === undefined || !/^(?:0x[0-9a-f]+|0b[01]+|[0-9]+)$/i.test(value)) throw new V2AssemblyError("INVALID_NUMBER", `${field} must be decimal, binary, or hexadecimal`, source);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new V2AssemblyError("OUT_OF_RANGE", `${field} must be in ${minimum}..${maximum}`, source);
  return parsed;
}

function splitParts(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

function requireParts(parts: readonly string[], count: number, source: SourceLine): void {
  if (parts.length !== count) throw new V2AssemblyError("INVALID_DIRECTIVE", `expected ${count - 1} argument(s)`, source);
}

function claimRom(claimed: Set<number>, address: number, source: SourceLine): void {
  if (address < 0 || address >= ROM_WORDS) throw new V2AssemblyError("OUT_OF_RANGE", `ROM address ${address} is outside 0..${ROM_WORDS - 1}`, source);
  if (claimed.has(address)) throw new V2AssemblyError("OVERLAPPING_SEGMENT", `ROM address ${address} is already occupied`, source);
  claimed.add(address);
}

function assertCanonicalWord(word: number, source: SourceLine): number {
  try {
    decodeInstruction(word);
    return word;
  } catch (error) {
    if (error instanceof V2IsaError) throw new V2AssemblyError(error.code, error.message, source);
    throw error;
  }
}

function expandFile(file: string, rootDir: string, active: Set<string>): SourceLine[] {
  const normalized = resolve(file);
  const relativeName = relative(rootDir, normalized);
  if (relativeName.startsWith("..") || isAbsolute(relativeName)) throw new Error(`include escapes assembler root: ${relativeName}`);
  if (active.has(normalized)) throw new Error(`cyclic include: ${relativeName}`);
  active.add(normalized);
  const contents = readFileSync(normalized, "utf8");
  const result: SourceLine[] = [];
  contents.split(/\r?\n/).forEach((text, index) => {
    const include = /^\s*\.include\s+["']([^"']+)["']\s*(?:[;#].*)?$/i.exec(text);
    if (include?.[1] !== undefined) {
      const child = resolve(dirname(normalized), include[1]);
      result.push(...expandFile(child, rootDir, active));
    } else {
      result.push({ file: relativeName || ".", line: index + 1, text });
    }
  });
  active.delete(normalized);
  return result;
}
