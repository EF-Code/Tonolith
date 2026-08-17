import { beginCell, Cell, type Slice } from "@ton/core";
import { ABI_VERSION, EVENT_PREFIX, MESSAGE_PREFIX } from "../../isa/src/constants.js";

export type Hash256 = string;

export interface CommonV2Message {
  readonly queryId: bigint;
  readonly runId: Hash256;
}

export interface AdvanceV2Message extends CommonV2Message {
  readonly kind: "advance";
  readonly expectedAdvanceCount: bigint;
  readonly expectedStateHash: Hash256;
  readonly maxInstructions: number;
  readonly maxOutputs: number;
}

export interface DispatchOutputV2Message extends CommonV2Message {
  readonly kind: "dispatchOutput";
  readonly expectedStateHash: Hash256;
  readonly outputId: Hash256;
}

export interface DeliverInputV2Message extends CommonV2Message {
  readonly kind: "deliverInput";
  readonly outputId: Hash256;
  readonly sourceCoreId: number;
  readonly destinationCoreId: number;
  readonly sourceEpoch: bigint;
  readonly destinationEpoch: bigint;
  readonly sourcePort: number;
  readonly destinationPort: number;
  readonly sequence: number;
  readonly value: number;
  readonly sourceInstructionCount: bigint;
  readonly sourceStateHash: Hash256;
}

export interface InputAcceptedV2Message extends CommonV2Message {
  readonly kind: "inputAccepted";
  readonly outputId: Hash256;
  readonly destinationCoreId: number;
  readonly destinationEpoch: bigint;
  readonly destinationStateHash: Hash256;
}

export interface TopUpV2Message extends CommonV2Message {
  readonly kind: "topUp";
}

export type V2Message = AdvanceV2Message | DispatchOutputV2Message | DeliverInputV2Message | InputAcceptedV2Message | TopUpV2Message;

export interface BatchAdvancedV2Event {
  readonly kind: "batchAdvanced";
  readonly queryId: bigint;
  readonly runId: Hash256;
  readonly coreId: number;
  readonly advanceCount: bigint;
  readonly epoch: bigint;
  readonly startInstructionCount: bigint;
  readonly endInstructionCount: bigint;
  readonly stepsExecuted: number;
  readonly outputsProduced: number;
  readonly stopReason: number;
  readonly previousStateHash: Hash256;
  readonly nextStateHash: Hash256;
  readonly batchCommitment: Hash256;
  readonly finalPc: number;
  readonly finalStatus: number;
}

export interface OutputCommittedV2Event {
  readonly kind: "outputCommitted";
  readonly queryId: bigint;
  readonly runId: Hash256;
  readonly outputId: Hash256;
  readonly sourceCoreId: number;
  readonly destinationCoreId: number;
  readonly epoch: bigint;
  readonly sourcePort: number;
  readonly destinationPort: number;
  readonly sequence: number;
  readonly value: number;
  readonly outputCommitment: Hash256;
}

export interface InputCommittedV2Event {
  readonly kind: "inputCommitted";
  readonly queryId: bigint;
  readonly runId: Hash256;
  readonly outputId: Hash256;
  readonly sourceCoreId: number;
  readonly destinationCoreId: number;
  readonly epoch: bigint;
  readonly destinationPort: number;
  readonly sequence: number;
  readonly inputCommitment: Hash256;
}

export interface OutputAcknowledgedV2Event {
  readonly kind: "outputAcknowledged";
  readonly queryId: bigint;
  readonly runId: Hash256;
  readonly outputId: Hash256;
  readonly destinationCoreId: number;
  readonly destinationEpoch: bigint;
  readonly outputCommitment: Hash256;
}

export type V2Event = BatchAdvancedV2Event | OutputCommittedV2Event | InputCommittedV2Event | OutputAcknowledgedV2Event;

export class V2AbiError extends Error {
  public readonly code: "SHORT_BODY" | "UNKNOWN_PREFIX" | "INVALID_VERSION" | "TRAILING_DATA" | "INVALID_FIELD";

  public constructor(code: V2AbiError["code"], message: string) {
    super(message);
    this.name = "V2AbiError";
    this.code = code;
  }
}

export function encodeAdvanceV2(message: Omit<AdvanceV2Message, "kind">): Cell {
  return commonCell(MESSAGE_PREFIX.advance, message)
    .storeUint(message.expectedAdvanceCount, 64)
    .storeUint(toBigInt(message.expectedStateHash), 256)
    .storeUint(message.maxInstructions, 16)
    .storeUint(message.maxOutputs, 8)
    .endCell();
}

export function decodeAdvanceV2(input: Cell | Slice): AdvanceV2Message {
  const slice = parseSlice(input, MESSAGE_PREFIX.advance);
  const common = readCommon(slice, MESSAGE_PREFIX.advance);
  const message: AdvanceV2Message = {
    kind: "advance",
    ...common,
    expectedAdvanceCount: slice.loadUintBig(64),
    expectedStateHash: loadHash(slice),
    maxInstructions: slice.loadUint(16),
    maxOutputs: slice.loadUint(8),
  };
  assertUnsigned(message.maxInstructions, 1, 0xffff, "maxInstructions");
  assertUnsigned(message.maxOutputs, 1, 0xff, "maxOutputs");
  finish(slice);
  return message;
}

export function encodeDispatchOutputV2(message: Omit<DispatchOutputV2Message, "kind">): Cell {
  return commonCell(MESSAGE_PREFIX.dispatchOutput, message)
    .storeUint(toBigInt(message.expectedStateHash), 256)
    .storeUint(toBigInt(message.outputId), 256)
    .endCell();
}

export function decodeDispatchOutputV2(input: Cell | Slice): DispatchOutputV2Message {
  const slice = parseSlice(input, MESSAGE_PREFIX.dispatchOutput);
  const common = readCommon(slice, MESSAGE_PREFIX.dispatchOutput);
  const message: DispatchOutputV2Message = {
    kind: "dispatchOutput",
    ...common,
    expectedStateHash: loadHash(slice),
    outputId: loadHash(slice),
  };
  finish(slice);
  return message;
}

export function encodeDeliverInputV2(message: Omit<DeliverInputV2Message, "kind">): Cell {
  const sourceState = beginCell().storeUint(toBigInt(message.sourceStateHash), 256).endCell();
  return commonCell(MESSAGE_PREFIX.deliverInput, message)
    .storeUint(toBigInt(message.outputId), 256)
    .storeUint(message.sourceCoreId, 16)
    .storeUint(message.destinationCoreId, 16)
    .storeUint(message.sourceEpoch, 64)
    .storeUint(message.destinationEpoch, 64)
    .storeUint(message.sourcePort, 4)
    .storeUint(message.destinationPort, 4)
    .storeUint(message.sequence, 8)
    .storeUint(message.value, 4)
    .storeUint(message.sourceInstructionCount, 64)
    .storeRef(sourceState)
    .endCell();
}

export function decodeDeliverInputV2(input: Cell | Slice): DeliverInputV2Message {
  const slice = parseSlice(input, MESSAGE_PREFIX.deliverInput);
  const common = readCommon(slice, MESSAGE_PREFIX.deliverInput);
  const outputId = loadHash(slice);
  const sourceCoreId = slice.loadUint(16);
  const destinationCoreId = slice.loadUint(16);
  const sourceEpoch = slice.loadUintBig(64);
  const destinationEpoch = slice.loadUintBig(64);
  const sourcePort = slice.loadUint(4);
  const destinationPort = slice.loadUint(4);
  const sequence = slice.loadUint(8);
  const value = slice.loadUint(4);
  const sourceInstructionCount = slice.loadUintBig(64);
  const sourceStateHash = loadHashRef(slice);
  const message: DeliverInputV2Message = {
    kind: "deliverInput",
    ...common,
    outputId,
    sourceCoreId,
    destinationCoreId,
    sourceEpoch,
    destinationEpoch,
    sourcePort,
    destinationPort,
    sequence,
    value,
    sourceInstructionCount,
    sourceStateHash,
  };
  assertUnsigned(message.sourcePort, 0, 15, "sourcePort");
  assertUnsigned(message.destinationPort, 0, 15, "destinationPort");
  assertUnsigned(message.value, 0, 15, "value");
  finish(slice);
  return message;
}

export function encodeInputAcceptedV2(message: Omit<InputAcceptedV2Message, "kind">): Cell {
  const detail = beginCell()
    .storeUint(toBigInt(message.outputId), 256)
    .storeUint(message.destinationCoreId, 16)
    .storeUint(message.destinationEpoch, 64)
    .storeUint(toBigInt(message.destinationStateHash), 256)
    .endCell();
  return commonCell(MESSAGE_PREFIX.inputAccepted, message)
    .storeRef(detail)
    .endCell();
}

export function decodeInputAcceptedV2(input: Cell | Slice): InputAcceptedV2Message {
  const slice = parseSlice(input, MESSAGE_PREFIX.inputAccepted);
  const common = readCommon(slice, MESSAGE_PREFIX.inputAccepted);
  const detail = slice.loadRef().beginParse();
  const message: InputAcceptedV2Message = {
    kind: "inputAccepted",
    ...common,
    outputId: loadHash(detail),
    destinationCoreId: detail.loadUint(16),
    destinationEpoch: detail.loadUintBig(64),
    destinationStateHash: loadHash(detail),
  };
  finish(detail);
  finish(slice);
  return message;
}

export function encodeTopUpV2(message: Omit<TopUpV2Message, "kind">): Cell {
  return commonCell(MESSAGE_PREFIX.topUp, message).endCell();
}

export function decodeTopUpV2(input: Cell | Slice): TopUpV2Message {
  const slice = parseSlice(input, MESSAGE_PREFIX.topUp);
  const common = readCommon(slice, MESSAGE_PREFIX.topUp);
  finish(slice);
  return { kind: "topUp", ...common };
}

export function decodeV2Message(input: Cell | Slice): V2Message {
  const slice = asSlice(input);
  if (slice.remainingBits < 32) throw new V2AbiError("SHORT_BODY", "message body does not contain an operation prefix");
  switch (slice.preloadUint(32)) {
    case MESSAGE_PREFIX.advance: return decodeAdvanceV2(slice);
    case MESSAGE_PREFIX.dispatchOutput: return decodeDispatchOutputV2(slice);
    case MESSAGE_PREFIX.deliverInput: return decodeDeliverInputV2(slice);
    case MESSAGE_PREFIX.inputAccepted: return decodeInputAcceptedV2(slice);
    case MESSAGE_PREFIX.topUp: return decodeTopUpV2(slice);
    default: throw new V2AbiError("UNKNOWN_PREFIX", "unknown v2 message prefix");
  }
}

export function encodeBatchAdvancedV2(event: Omit<BatchAdvancedV2Event, "kind">): Cell {
  const detail = beginCell()
    .storeUint(toBigInt(event.previousStateHash), 256)
    .storeUint(toBigInt(event.nextStateHash), 256)
    .storeUint(toBigInt(event.batchCommitment), 256)
    .storeUint(event.finalPc, 10)
    .storeUint(event.finalStatus, 3)
    .endCell();
  return beginCell()
    .storeUint(EVENT_PREFIX.batchAdvanced, 32)
    .storeUint(ABI_VERSION, 16)
    .storeUint(event.queryId, 64)
    .storeUint(toBigInt(event.runId), 256)
    .storeUint(event.coreId, 16)
    .storeUint(event.advanceCount, 64)
    .storeUint(event.epoch, 64)
    .storeUint(event.startInstructionCount, 64)
    .storeUint(event.endInstructionCount, 64)
    .storeUint(event.stepsExecuted, 16)
    .storeUint(event.outputsProduced, 8)
    .storeUint(event.stopReason, 8)
    .storeRef(detail)
    .endCell();
}

export function decodeBatchAdvancedV2(input: Cell | Slice): BatchAdvancedV2Event {
  const slice = parseSlice(input, EVENT_PREFIX.batchAdvanced);
  const common = readEventCommon(slice, EVENT_PREFIX.batchAdvanced);
  const coreId = slice.loadUint(16);
  const advanceCount = slice.loadUintBig(64);
  const epoch = slice.loadUintBig(64);
  const startInstructionCount = slice.loadUintBig(64);
  const endInstructionCount = slice.loadUintBig(64);
  const stepsExecuted = slice.loadUint(16);
  const outputsProduced = slice.loadUint(8);
  const stopReason = slice.loadUint(8);
  const detail = slice.loadRef().beginParse();
  const previousStateHash = loadHash(detail);
  const nextStateHash = loadHash(detail);
  const batchCommitment = loadHash(detail);
  const finalPc = detail.loadUint(10);
  const finalStatus = detail.loadUint(3);
  finish(detail);
  const event: BatchAdvancedV2Event = {
    kind: "batchAdvanced",
    ...common,
    coreId,
    advanceCount,
    epoch,
    startInstructionCount,
    endInstructionCount,
    stepsExecuted,
    outputsProduced,
    stopReason,
    previousStateHash,
    nextStateHash,
    batchCommitment,
    finalPc,
    finalStatus,
  };
  finish(slice);
  return event;
}

export function encodeOutputCommittedV2(event: Omit<OutputCommittedV2Event, "kind">): Cell {
  return beginCell()
    .storeUint(EVENT_PREFIX.outputCommitted, 32)
    .storeUint(ABI_VERSION, 16)
    .storeUint(event.queryId, 64)
    .storeUint(toBigInt(event.runId), 256)
    .storeUint(toBigInt(event.outputId), 256)
    .storeUint(event.sourceCoreId, 16)
    .storeUint(event.destinationCoreId, 16)
    .storeUint(event.epoch, 64)
    .storeUint(event.sourcePort, 4)
    .storeUint(event.destinationPort, 4)
    .storeUint(event.sequence, 8)
    .storeUint(event.value, 4)
    .storeUint(toBigInt(event.outputCommitment), 256)
    .endCell();
}

export function decodeOutputCommittedV2(input: Cell | Slice): OutputCommittedV2Event {
  const slice = parseSlice(input, EVENT_PREFIX.outputCommitted);
  const common = readEventCommon(slice, EVENT_PREFIX.outputCommitted);
  const event: OutputCommittedV2Event = {
    kind: "outputCommitted",
    ...common,
    outputId: loadHash(slice),
    sourceCoreId: slice.loadUint(16),
    destinationCoreId: slice.loadUint(16),
    epoch: slice.loadUintBig(64),
    sourcePort: slice.loadUint(4),
    destinationPort: slice.loadUint(4),
    sequence: slice.loadUint(8),
    value: slice.loadUint(4),
    outputCommitment: loadHash(slice),
  };
  finish(slice);
  return event;
}

export function encodeInputCommittedV2(event: Omit<InputCommittedV2Event, "kind">): Cell {
  return beginCell()
    .storeUint(EVENT_PREFIX.inputCommitted, 32)
    .storeUint(ABI_VERSION, 16)
    .storeUint(event.queryId, 64)
    .storeUint(toBigInt(event.runId), 256)
    .storeUint(toBigInt(event.outputId), 256)
    .storeUint(event.sourceCoreId, 16)
    .storeUint(event.destinationCoreId, 16)
    .storeUint(event.epoch, 64)
    .storeUint(event.destinationPort, 4)
    .storeUint(event.sequence, 8)
    .storeUint(toBigInt(event.inputCommitment), 256)
    .endCell();
}

export function decodeInputCommittedV2(input: Cell | Slice): InputCommittedV2Event {
  const slice = parseSlice(input, EVENT_PREFIX.inputCommitted);
  const common = readEventCommon(slice, EVENT_PREFIX.inputCommitted);
  const event: InputCommittedV2Event = {
    kind: "inputCommitted",
    ...common,
    outputId: loadHash(slice),
    sourceCoreId: slice.loadUint(16),
    destinationCoreId: slice.loadUint(16),
    epoch: slice.loadUintBig(64),
    destinationPort: slice.loadUint(4),
    sequence: slice.loadUint(8),
    inputCommitment: loadHash(slice),
  };
  finish(slice);
  return event;
}

export function encodeOutputAcknowledgedV2(event: Omit<OutputAcknowledgedV2Event, "kind">): Cell {
  return beginCell()
    .storeUint(EVENT_PREFIX.outputAcknowledged, 32)
    .storeUint(ABI_VERSION, 16)
    .storeUint(event.queryId, 64)
    .storeUint(toBigInt(event.runId), 256)
    .storeUint(toBigInt(event.outputId), 256)
    .storeUint(event.destinationCoreId, 16)
    .storeUint(event.destinationEpoch, 64)
    .storeUint(toBigInt(event.outputCommitment), 256)
    .endCell();
}

export function decodeOutputAcknowledgedV2(input: Cell | Slice): OutputAcknowledgedV2Event {
  const slice = parseSlice(input, EVENT_PREFIX.outputAcknowledged);
  const common = readEventCommon(slice, EVENT_PREFIX.outputAcknowledged);
  const event: OutputAcknowledgedV2Event = {
    kind: "outputAcknowledged",
    ...common,
    outputId: loadHash(slice),
    destinationCoreId: slice.loadUint(16),
    destinationEpoch: slice.loadUintBig(64),
    outputCommitment: loadHash(slice),
  };
  finish(slice);
  return event;
}

export function decodeV2Event(input: Cell | Slice): V2Event {
  const slice = asSlice(input);
  if (slice.remainingBits < 32) throw new V2AbiError("SHORT_BODY", "event body does not contain a prefix");
  switch (slice.preloadUint(32)) {
    case EVENT_PREFIX.batchAdvanced: return decodeBatchAdvancedV2(slice);
    case EVENT_PREFIX.outputCommitted: return decodeOutputCommittedV2(slice);
    case EVENT_PREFIX.inputCommitted: return decodeInputCommittedV2(slice);
    case EVENT_PREFIX.outputAcknowledged: return decodeOutputAcknowledgedV2(slice);
    default: throw new V2AbiError("UNKNOWN_PREFIX", "unknown v2 event prefix");
  }
}

export function encodeV2Event(event: V2Event): Cell {
  switch (event.kind) {
    case "batchAdvanced": return encodeBatchAdvancedV2(event);
    case "outputCommitted": return encodeOutputCommittedV2(event);
    case "inputCommitted": return encodeInputCommittedV2(event);
    case "outputAcknowledged": return encodeOutputAcknowledgedV2(event);
  }
}

function commonCell(op: number, message: CommonV2Message): ReturnType<typeof beginCell> {
  return beginCell()
    .storeUint(op, 32)
    .storeUint(ABI_VERSION, 16)
    .storeUint(message.queryId, 64)
    .storeUint(toBigInt(message.runId), 256);
}

function readCommon(slice: Slice, expectedOp: number): CommonV2Message {
  const op = loadUintSafe(slice, 32, "operation");
  if (op !== expectedOp) throw new V2AbiError("UNKNOWN_PREFIX", "unexpected operation prefix");
  const version = loadUintSafe(slice, 16, "abiVersion");
  if (version !== ABI_VERSION) throw new V2AbiError("INVALID_VERSION", `unsupported ABI version ${version}`);
  return { queryId: slice.loadUintBig(64), runId: loadHash(slice) };
}

function readEventCommon(slice: Slice, expectedEvent: number): CommonV2Message {
  const event = loadUintSafe(slice, 32, "event");
  if (event !== expectedEvent) throw new V2AbiError("UNKNOWN_PREFIX", "unexpected event prefix");
  const version = loadUintSafe(slice, 16, "abiVersion");
  if (version !== ABI_VERSION) throw new V2AbiError("INVALID_VERSION", `unsupported ABI version ${version}`);
  return { queryId: slice.loadUintBig(64), runId: loadHash(slice) };
}

function parseSlice(input: Cell | Slice, expectedPrefix: number): Slice {
  const slice = asSlice(input);
  if (slice.remainingBits < 32) throw new V2AbiError("SHORT_BODY", "body is shorter than the operation prefix");
  if (slice.preloadUint(32) !== expectedPrefix) throw new V2AbiError("UNKNOWN_PREFIX", "unexpected operation prefix");
  return slice;
}

function asSlice(input: Cell | Slice): Slice {
  return input instanceof Cell ? input.beginParse() : input;
}

function finish(slice: Slice): void {
  if (slice.remainingBits !== 0 || slice.remainingRefs !== 0) throw new V2AbiError("TRAILING_DATA", "message contains trailing bits or references");
}

function loadHash(slice: Slice): Hash256 {
  return slice.loadUintBig(256).toString(16).padStart(64, "0");
}

function loadHashRef(slice: Slice): Hash256 {
  const ref = slice.loadRef().beginParse();
  const hash = loadHash(ref);
  finish(ref);
  return hash;
}

function toBigInt(value: Hash256): bigint {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new V2AbiError("INVALID_FIELD", "hash must be a 256-bit hexadecimal value");
  return BigInt(`0x${value}`);
}

function loadUintSafe(slice: Slice, bits: number, field: string): number {
  try {
    return slice.loadUint(bits);
  } catch (error) {
    throw new V2AbiError("SHORT_BODY", `cannot read ${field}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertUnsigned(value: number, minimum: number, maximum: number, field: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new V2AbiError("INVALID_FIELD", `${field} must be in ${minimum}..${maximum}`);
}
