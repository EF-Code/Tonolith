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
  if (typeof trace.runId !== "string" || !/^[0-9a-f]{64}$/.test(trace.runId)) throw new TypeError("invalid trace run ID");
  if (!Array.isArray(trace.frames) || !Array.isArray(trace.coreIds)) throw new TypeError("trace frames and coreIds must be arrays");
  let previous = -1;
  for (const frame of trace.frames) {
    if (!Number.isInteger(frame.index) || frame.index <= previous) throw new TypeError("trace frame indexes must be strictly increasing");
    previous = frame.index;
    validateState(frame.before);
    validateState(frame.after);
  }
}

function validateState(value: unknown): asserts value is TraceStateSnapshot {
  if (value === null || typeof value !== "object" || typeof (value as TraceStateSnapshot).stateHash !== "string") throw new TypeError("invalid trace state snapshot");
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
