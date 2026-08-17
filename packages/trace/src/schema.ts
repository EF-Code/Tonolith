import type { Hash256 } from "../../abi/src/messages.js";

export const V2_TRACE_SCHEMA = "tonolith-trace-v2" as const;
export type TraceEvidence = "local-emulator" | "acton-sandbox" | "local-validator" | "testnet";
export type MessagePhase = "none" | "committed" | "dispatched" | "destination-included" | "acknowledged" | "finalized";

export interface TraceStateSnapshot {
  readonly stateHash: Hash256;
  readonly pc: number;
  readonly accumulator: number;
  readonly flags: number;
  readonly epoch: string;
  readonly instructionCount: string;
  readonly advanceCount: string;
  readonly status: number;
  readonly outputCommitment: Hash256;
  readonly inputCommitment: Hash256;
  readonly inboxCount: number;
  readonly outboxCount: number;
}

export interface TraceFrame {
  readonly index: number;
  readonly coreId: number;
  readonly instructionWord?: number;
  readonly opcode?: number;
  readonly sourceLine?: number;
  readonly before: TraceStateSnapshot;
  readonly after: TraceStateSnapshot;
  readonly phase: MessagePhase;
  readonly outputId?: Hash256;
  readonly transactionHash?: string;
  readonly transactionFinalized?: boolean;
  readonly note?: string;
}

export interface TonolithTraceV2 {
  readonly schema: typeof V2_TRACE_SCHEMA;
  readonly evidence: TraceEvidence;
  readonly network: "local" | "testnet";
  readonly runId: Hash256;
  readonly coreIds: readonly number[];
  readonly programId: Hash256;
  readonly romRoot: Hash256;
  readonly routeRoot: Hash256;
  readonly staticCommitment: Hash256;
  readonly frames: readonly TraceFrame[];
  readonly unresolved: readonly string[];
}

export function encodeTrace(trace: TonolithTraceV2): string {
  validateTrace(trace);
  return JSON.stringify(trace, canonicalReplacer);
}

export function decodeTrace(serialized: string): TonolithTraceV2 {
  const value: unknown = JSON.parse(serialized);
  validateTrace(value);
  return value;
}

export function validateTrace(value: unknown): asserts value is TonolithTraceV2 {
  if (value === null || typeof value !== "object") throw new TypeError("trace must be an object");
  const trace = value as Partial<TonolithTraceV2>;
  if (trace.schema !== V2_TRACE_SCHEMA) throw new TypeError("unsupported trace schema");
  if (trace.evidence === undefined || !["local-emulator", "acton-sandbox", "local-validator", "testnet"].includes(trace.evidence)) throw new TypeError("invalid trace evidence");
  if (trace.network !== "local" && trace.network !== "testnet") throw new TypeError("invalid trace network");
  if (trace.evidence === "testnet" && trace.network !== "testnet") throw new TypeError("testnet evidence requires a testnet trace");
  if (trace.evidence !== "testnet" && trace.network !== "local") throw new TypeError("local evidence requires a local trace");
  assertHash(trace.runId, "trace run ID");
  assertHash(trace.programId, "trace program ID");
  assertHash(trace.romRoot, "trace ROM root");
  assertHash(trace.routeRoot, "trace route root");
  assertHash(trace.staticCommitment, "trace static commitment");
  if (!Array.isArray(trace.frames) || !Array.isArray(trace.coreIds)) throw new TypeError("trace frames and coreIds must be arrays");
  const coreIds = trace.coreIds as readonly unknown[];
  const knownCoreIds = new Set<number>();
  for (const coreId of coreIds) {
    assertInteger(coreId, 0, 0xffff, "trace core ID");
    if (knownCoreIds.has(coreId)) throw new TypeError("trace core IDs must be unique");
    knownCoreIds.add(coreId);
  }
  if (!Array.isArray(trace.unresolved) || trace.unresolved.some((entry) => typeof entry !== "string")) {
    throw new TypeError("trace unresolved must be an array of strings");
  }
  let previous = -1;
  const lastAfterByCore = new Map<number, TraceStateSnapshot>();
  for (const candidate of trace.frames) {
    const frame = validateFrame(candidate, knownCoreIds);
    if (!Number.isInteger(frame.index) || frame.index < 0 || frame.index <= previous) throw new TypeError("trace frame indexes must be strictly increasing");
    previous = frame.index;
    const prior = lastAfterByCore.get(frame.coreId);
    if (prior !== undefined && prior.stateHash !== frame.before.stateHash) {
      throw new TypeError(`trace core ${frame.coreId} does not continue from the previous state`);
    }
    if (BigInt(frame.after.instructionCount) < BigInt(frame.before.instructionCount)) {
      throw new TypeError("trace instruction count cannot move backwards");
    }
    if (BigInt(frame.after.advanceCount) < BigInt(frame.before.advanceCount)) {
      throw new TypeError("trace advance count cannot move backwards");
    }
    lastAfterByCore.set(frame.coreId, frame.after);
  }
}

function validateState(value: unknown): asserts value is TraceStateSnapshot {
  if (value === null || typeof value !== "object") throw new TypeError("invalid trace state snapshot");
  const state = value as Partial<TraceStateSnapshot>;
  assertHash(state.stateHash, "trace state hash");
  assertInteger(state.pc, 0, 1023, "trace PC");
  assertInteger(state.accumulator, 0, 15, "trace accumulator");
  assertInteger(state.flags, 0, 3, "trace flags");
  assertDecimal(state.epoch, "trace epoch");
  assertDecimal(state.instructionCount, "trace instruction count");
  assertDecimal(state.advanceCount, "trace advance count");
  assertInteger(state.status, 0, 4, "trace status");
  assertHash(state.outputCommitment, "trace output commitment");
  assertHash(state.inputCommitment, "trace input commitment");
  assertInteger(state.inboxCount, 0, 16, "trace inbox count");
  assertInteger(state.outboxCount, 0, 16, "trace outbox count");
}

function validateFrame(value: unknown, coreIds: ReadonlySet<number>): TraceFrame {
  if (value === null || typeof value !== "object") throw new TypeError("invalid trace frame");
  const frame = value as Partial<TraceFrame>;
  assertInteger(frame.index, 0, Number.MAX_SAFE_INTEGER, "trace frame index");
  assertInteger(frame.coreId, 0, 0xffff, "trace frame core ID");
  if (!coreIds.has(frame.coreId)) throw new TypeError("trace frame core ID is not declared");
  if (frame.instructionWord !== undefined) assertInteger(frame.instructionWord, 0, 0xffff, "trace instruction word");
  if (frame.opcode !== undefined) assertInteger(frame.opcode, 0, 0x0f, "trace opcode");
  if (frame.sourceLine !== undefined) assertInteger(frame.sourceLine, 0, Number.MAX_SAFE_INTEGER, "trace source line");
  if (frame.phase === undefined || !["none", "committed", "dispatched", "destination-included", "acknowledged", "finalized"].includes(frame.phase)) {
    throw new TypeError("invalid trace message phase");
  }
  if (frame.outputId !== undefined) assertHash(frame.outputId, "trace output ID");
  if (frame.transactionHash !== undefined && !/^[0-9a-f]{64}$/i.test(frame.transactionHash)) throw new TypeError("invalid trace transaction hash");
  if (frame.transactionFinalized !== undefined && typeof frame.transactionFinalized !== "boolean") throw new TypeError("invalid trace finality flag");
  if (frame.note !== undefined && typeof frame.note !== "string") throw new TypeError("invalid trace note");
  validateState(frame.before);
  validateState(frame.after);
  return frame as TraceFrame;
}

function assertHash(value: unknown, field: string): asserts value is Hash256 {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`invalid ${field}`);
}

function assertDecimal(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new TypeError(`invalid ${field}`);
}

function assertInteger(value: unknown, minimum: number, maximum: number, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`invalid ${field}`);
  }
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
