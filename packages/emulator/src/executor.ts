import {
  FLAG_CARRY,
  FLAG_ZERO,
  MAX_INPUT_RECORDS,
  MAX_OUTPUT_RECORDS,
  MAX_PORTS,
  NIBBLE_MASK,
  PC_MASK,
  ROM_WORDS,
  STATUS,
  STOP_REASON,
  SYS,
  type CoreStatus,
  type StopReason,
} from "../../isa/src/constants.js";
import {
  decodeInstruction,
} from "../../isa/src/codec.js";
import { Opcode, type DecodedInstruction } from "../../isa/src/types.js";
import {
  assertHash,
  assertStateBounds,
  cloneState,
  type Hash256,
  type InputRecord,
  type LegacyOutput,
  type OutputRecord,
  type V2State,
} from "./model.js";
import {
  batchCommitment,
  nextAcknowledgedOutputCommitment,
  nextEpochCommitment,
  nextInputCommitment,
  nextLegacyOutputCommitment,
  nextOutputCommitment,
  outputId,
  stateHash,
  traceCommitment,
} from "./commitments.js";

export interface V2ExecutionEnvironment {
  readonly rom: readonly number[];
}

export interface V2AdvanceRequest {
  readonly queryId?: bigint;
  readonly expectedAdvanceCount: bigint;
  readonly expectedStateHash: Hash256;
  readonly maxInstructions: number;
  readonly maxOutputs: number;
}

export interface V2StepResult {
  readonly state: V2State;
  readonly executed: boolean;
  readonly word: number;
  readonly instruction: DecodedInstruction;
  readonly output?: OutputRecord;
  readonly legacyOutput?: LegacyOutput;
  readonly stopReason?: StopReason;
}

export interface V2BatchResult {
  readonly state: V2State;
  readonly previousStateHash: Hash256;
  readonly nextStateHash: Hash256;
  readonly traceCommitment: Hash256;
  readonly batchCommitment: Hash256;
  readonly outputs: readonly OutputRecord[];
  readonly legacyOutputs: readonly LegacyOutput[];
  readonly executed: number;
  readonly stopReason: StopReason;
}

export interface DispatchOutputRequest {
  readonly queryId?: bigint;
  readonly expectedStateHash: Hash256;
  readonly outputId: Hash256;
}

export interface DeliverInputMessage {
  readonly queryId?: bigint;
  readonly runId: Hash256;
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

export interface InputAcknowledgement {
  readonly queryId?: bigint;
  readonly runId: Hash256;
  readonly outputId: Hash256;
  readonly destinationCoreId: number;
  readonly destinationEpoch: bigint;
  readonly destinationStateHash: Hash256;
}

export interface DispatchResult {
  readonly state: V2State;
  readonly message: DeliverInputMessage;
}

export interface DeliveryResult {
  readonly state: V2State;
  readonly acknowledgement: InputAcknowledgement;
  readonly duplicate: boolean;
}

export interface AcknowledgementResult {
  readonly state: V2State;
  readonly duplicate: boolean;
}

export class V2ExecutionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "V2ExecutionError";
    this.code = code;
  }
}

/** Execute one canonical instruction without invoking the contract or Acton. */
export function step(state: V2State, environment: V2ExecutionEnvironment): V2StepResult {
  assertStateBounds(state);
  if (state.status !== STATUS.running) {
    throw new V2ExecutionError("INVALID_STATUS", "step requires a RUNNING core");
  }
  if (environment.rom.length > ROM_WORDS) {
    throw new V2ExecutionError("INVALID_ROM", `ROM contains more than ${ROM_WORDS} words`);
  }
  const word = environment.rom[state.pc];
  if (word === undefined) {
    throw new V2ExecutionError("INVALID_PC", `PC ${state.pc} is outside the supplied ROM`);
  }

  let instruction: DecodedInstruction;
  try {
    instruction = decodeInstruction(word);
  } catch (error) {
    throw new V2ExecutionError(
      "INVALID_INSTRUCTION",
      error instanceof Error ? error.message : String(error),
    );
  }

  const beforeStateHash = stateHash(state);
  const next = cloneState(state);
  next.pc = (next.pc + 1) & PC_MASK;
  let output: OutputRecord | undefined;
  let legacyOutput: LegacyOutput | undefined;
  let stopReason: StopReason | undefined;
  let closesEpoch = false;

  switch (instruction.opcode) {
    case Opcode.NOP:
      break;
    case Opcode.LDI:
      next.accumulator = instruction.operand;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      break;
    case Opcode.LDR:
      next.accumulator = readRegister(next, instruction.operand);
      next.flags = setZeroFlag(next.flags, next.accumulator);
      break;
    case Opcode.STR:
      writeRegister(next, instruction.operand, next.accumulator);
      break;
    case Opcode.ADD:
      add(next, readRegister(next, instruction.operand), false);
      break;
    case Opcode.ADC:
      add(next, readRegister(next, instruction.operand), hasFlag(next.flags, FLAG_CARRY));
      break;
    case Opcode.SUB:
      subtract(next, readRegister(next, instruction.operand));
      break;
    case Opcode.AND:
      logical(next, next.accumulator & readRegister(next, instruction.operand));
      break;
    case Opcode.OR:
      logical(next, next.accumulator | readRegister(next, instruction.operand));
      break;
    case Opcode.XOR:
      logical(next, next.accumulator ^ readRegister(next, instruction.operand));
      break;
    case Opcode.LDM:
      next.accumulator = readRam(next, instruction.operand);
      next.flags = setZeroFlag(next.flags, next.accumulator);
      break;
    case Opcode.STM:
      writeRam(next, instruction.operand, next.accumulator);
      break;
    case Opcode.JMP:
      next.pc = instruction.operand;
      break;
    case Opcode.JZ:
      if (hasFlag(next.flags, FLAG_ZERO)) next.pc = instruction.operand;
      break;
    case Opcode.JC:
      if (hasFlag(next.flags, FLAG_CARRY)) next.pc = instruction.operand;
      break;
    case Opcode.SYS: {
      const sysResult = executeSys(next, state, instruction, beforeStateHash);
      if (sysResult.blocked) {
        next.pc = state.pc;
        next.status = sysResult.status;
        const blockedResult = {
          state: next,
          executed: false,
          word,
          instruction,
        };
        return sysResult.stopReason === undefined
          ? blockedResult
          : { ...blockedResult, stopReason: sysResult.stopReason };
      }
      output = sysResult.output;
      legacyOutput = sysResult.legacyOutput;
      stopReason = sysResult.stopReason;
      closesEpoch = sysResult.closesEpoch;
      break;
    }
    default:
      throw new V2ExecutionError("INVALID_INSTRUCTION", `unsupported opcode ${instruction.opcode}`);
  }

  next.instructionCount += 1n;
  if (output !== undefined) {
    next.outputCount += 1n;
    next.outputCommitment = nextOutputCommitment(next.outputCommitment, output);
  }
  if (legacyOutput !== undefined) {
    next.outputCount += 1n;
    next.outputCommitment = nextLegacyOutputCommitment(
      next.outputCommitment,
      legacyOutput.outputIndex,
      legacyOutput.instructionCount,
      legacyOutput.value,
    );
    legacyOutput = {
      ...legacyOutput,
      instructionCount: next.instructionCount,
      outputCommitment: next.outputCommitment,
    };
  }

  if (closesEpoch) {
    const closedEpoch = next.epoch;
    const closedStateHash = stateHash(next);
    next.epochHistoryCommitment = nextEpochCommitment(
      next.epochHistoryCommitment,
      closedEpoch,
      closedStateHash,
      next.outputCommitment,
      next.inputCommitment,
    );
    next.epoch += 1n;
    next.status = isEpochReady(next, next.epoch) ? STATUS.running : STATUS.waitingInput;
  }

  assertStateBounds(next);
  const result: V2StepResult = {
    state: next,
    executed: true,
    word,
    instruction,
    ...(output === undefined ? {} : { output }),
    ...(legacyOutput === undefined ? {} : { legacyOutput }),
    ...(stopReason === undefined ? {} : { stopReason }),
  };
  return result;
}

/** Apply an authenticated bounded AdvanceV2 request to a cloned architectural state. */
export function advance(
  state: V2State,
  environment: V2ExecutionEnvironment,
  request: V2AdvanceRequest,
): V2BatchResult {
  assertStateBounds(state);
  assertHash(request.expectedStateHash, "expectedStateHash");
  if (request.expectedAdvanceCount !== state.advanceCount) {
    throw new V2ExecutionError("STALE_ADVANCE", "expected advance count does not match state");
  }
  const previousStateHash = stateHash(state);
  if (request.expectedStateHash.toLowerCase() !== previousStateHash) {
    throw new V2ExecutionError("STATE_HASH_MISMATCH", "expected state hash does not match state");
  }
  if (state.status === STATUS.halted || state.status === STATUS.faulted) {
    throw new V2ExecutionError("INVALID_STATUS", "a halted or faulted core cannot advance");
  }
  assertStepLimit(request.maxInstructions, state.config.maxStepsPerAdvance);
  assertOutputLimit(request.maxOutputs, state.config.maxOutputRecords ?? MAX_OUTPUT_RECORDS);

  let current = cloneState(state);
  if (current.status === STATUS.waitingInput || current.status === STATUS.backpressured) {
    current.status = STATUS.running;
  }
  const outputs: OutputRecord[] = [];
  const legacyOutputs: LegacyOutput[] = [];
  let trace = previousStateHash;
  let executed = 0;
  let stopReason: StopReason = STOP_REASON.requestLimit;

  while (executed < request.maxInstructions) {
    if (current.status !== STATUS.running) {
      stopReason = current.status === STATUS.halted ? STOP_REASON.halted : STOP_REASON.faulted;
      break;
    }
    const result = step(current, environment);
    current = result.state;
    if (!result.executed) {
      stopReason = result.stopReason ?? STOP_REASON.requestLimit;
      break;
    }
    executed += 1;
    trace = traceCommitment(trace, result.word, stateHash(current));
    if (result.output !== undefined) outputs.push(result.output);
    if (result.legacyOutput !== undefined) legacyOutputs.push(result.legacyOutput);
    const produced = outputs.length + legacyOutputs.length;
    if (produced >= request.maxOutputs) {
      stopReason = STOP_REASON.outputEventLimit;
      break;
    }
    if (result.stopReason !== undefined) {
      stopReason = result.stopReason;
      break;
    }
  }

  current.advanceCount += 1n;
  current.acceptedMessageCount += 1n;
  assertStateBounds(current);
  const nextStateHash = stateHash(current);
  const acceptedBatch = batchCommitment({
    previousStateHash,
    nextStateHash,
    startInstructionCount: state.instructionCount,
    endInstructionCount: current.instructionCount,
    stepsExecuted: executed,
    outputsProduced: outputs.length + legacyOutputs.length,
    stopReason,
    traceCommitment: trace,
  });
  return {
    state: current,
    previousStateHash,
    nextStateHash,
    traceCommitment: trace,
    batchCommitment: acceptedBatch,
    outputs,
    legacyOutputs,
    executed,
    stopReason,
  };
}

/** Select a pending output without mutating architectural state. */
export function dispatchOutput(state: V2State, request: DispatchOutputRequest): DispatchResult {
  assertHash(request.expectedStateHash, "expectedStateHash");
  const currentHash = stateHash(state);
  if (request.expectedStateHash.toLowerCase() !== currentHash) {
    throw new V2ExecutionError("STATE_HASH_MISMATCH", "expected state hash does not match state");
  }
  const record = state.outbox.find((candidate) => candidate.outputId === request.outputId.toLowerCase());
  if (record === undefined) {
    throw new V2ExecutionError("NOT_FOUND", "pending output was not found");
  }
  const message: DeliverInputMessage = {
    runId: state.config.runId,
    outputId: record.outputId,
    sourceCoreId: record.sourceCoreId,
    destinationCoreId: record.destinationCoreId,
    sourceEpoch: record.sourceEpoch,
    destinationEpoch: record.destinationEpoch,
    sourcePort: record.sourcePort,
    destinationPort: record.destinationPort,
    sequence: record.sequence,
    value: record.value,
    sourceInstructionCount: record.sourceInstructionCount,
    sourceStateHash: record.sourceStateHash,
  };
  if (request.queryId !== undefined) {
    (message as { queryId: bigint }).queryId = request.queryId;
  }
  return { state: cloneState(state), message };
}

/** Deliver one output to the destination's bounded, deduplicating inbox. */
export function deliverInput(
  state: V2State,
  message: DeliverInputMessage,
  authenticatedSourceCoreId = message.sourceCoreId,
): DeliveryResult {
  validateDeliveryEnvelope(state, message, authenticatedSourceCoreId);
  const existing = state.inbox.find((record) => record.outputId === message.outputId.toLowerCase());
  if (existing !== undefined) {
    if (!sameInput(existing, message)) {
      throw new V2ExecutionError("CONFLICTING_REPLAY", "output identifier is bound to different input data");
    }
    return {
      state: cloneState(state),
      acknowledgement: makeAcknowledgement(state, message),
      duplicate: true,
    };
  }

  const slotConflict = state.inbox.find(
    (record) =>
      record.destinationEpoch === message.destinationEpoch &&
      record.destinationPort === message.destinationPort &&
      record.sequence === message.sequence,
  );
  if (slotConflict !== undefined) {
    throw new V2ExecutionError("CONFLICTING_REPLAY", "input slot is already occupied by another output");
  }
  if (state.inbox.length >= (state.config.maxInputRecords ?? MAX_INPUT_RECORDS)) {
    throw new V2ExecutionError("QUEUE_FULL", "input queue is full");
  }

  const next = cloneState(state);
  const input: InputRecord = {
    ...message,
    outputId: message.outputId.toLowerCase(),
    consumed: false,
  };
  next.inbox.push(input);
  next.inbox.sort(compareInputs);
  next.inputCount += 1n;
  next.acceptedMessageCount += 1n;
  next.inputCommitment = nextInputCommitment(next.inputCommitment, input);
  if (next.status === STATUS.waitingInput && hasAvailableInput(next, next.epoch)) {
    next.status = STATUS.running;
  }
  assertStateBounds(next);
  return {
    state: next,
    acknowledgement: makeAcknowledgement(next, message),
    duplicate: false,
  };
}

/** Consume an acknowledgement and retire exactly one pending output. */
export function acknowledgeOutput(
  state: V2State,
  acknowledgement: InputAcknowledgement,
  authenticatedDestinationCoreId = acknowledgement.destinationCoreId,
): AcknowledgementResult {
  if (acknowledgement.runId.toLowerCase() !== state.config.runId.toLowerCase()) {
    throw new V2ExecutionError("INVALID_RUN", "acknowledgement run ID does not match state");
  }
  if (authenticatedDestinationCoreId !== acknowledgement.destinationCoreId) {
    throw new V2ExecutionError("UNAUTHORIZED_PEER", "acknowledgement sender is not the destination core");
  }
  const index = state.outbox.findIndex((record) => record.outputId === acknowledgement.outputId.toLowerCase());
  if (index < 0) return { state: cloneState(state), duplicate: true };
  const record = state.outbox[index];
  if (record === undefined || record.destinationCoreId !== acknowledgement.destinationCoreId || record.destinationEpoch !== acknowledgement.destinationEpoch) {
    throw new V2ExecutionError("UNAUTHORIZED_PEER", "acknowledgement does not match pending output");
  }
  const next = cloneState(state);
  next.outbox.splice(index, 1);
  next.acceptedMessageCount += 1n;
  next.outputCommitment = nextAcknowledgedOutputCommitment(next.outputCommitment, record.outputId);
  if (next.status === STATUS.backpressured && next.outbox.length < (next.config.maxOutputRecords ?? MAX_OUTPUT_RECORDS)) {
    next.status = STATUS.running;
  }
  assertStateBounds(next);
  return { state: next, duplicate: false };
}

function executeSys(
  next: V2State,
  before: V2State,
  instruction: DecodedInstruction,
  beforeStateHash: Hash256,
): {
  blocked: boolean;
  status: CoreStatus;
  stopReason?: StopReason;
  output?: OutputRecord;
  legacyOutput?: LegacyOutput;
  closesEpoch: boolean;
} {
  const subop = instruction.sysSubop;
  if (subop === undefined) throw new V2ExecutionError("INVALID_INSTRUCTION", "SYS instruction has no suboperation");
  switch (subop) {
    case SYS.HALT:
      next.status = STATUS.halted;
      return { blocked: false, status: next.status, stopReason: STOP_REASON.halted, closesEpoch: false };
    case SYS.OUT: {
      const legacyOutput: LegacyOutput = {
        outputIndex: next.outputCount,
        instructionCount: before.instructionCount + 1n,
        value: next.accumulator,
        outputCommitment: next.outputCommitment,
      };
      return { blocked: false, status: next.status, legacyOutput, closesEpoch: false };
    }
    case SYS.CLC:
      next.flags &= ~FLAG_CARRY;
      return { blocked: false, status: next.status, closesEpoch: false };
    case SYS.STC:
      next.flags |= FLAG_CARRY;
      return { blocked: false, status: next.status, closesEpoch: false };
    case SYS.NOT:
      logical(next, (~next.accumulator) & NIBBLE_MASK);
      return { blocked: false, status: next.status, closesEpoch: false };
    case SYS.SHL: {
      const previous = next.accumulator;
      next.flags = previous & 0x8 ? next.flags | FLAG_CARRY : next.flags & ~FLAG_CARRY;
      next.accumulator = (previous << 1) & NIBBLE_MASK;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      return { blocked: false, status: next.status, closesEpoch: false };
    }
    case SYS.SHR: {
      const previous = next.accumulator;
      next.flags = previous & 0x1 ? next.flags | FLAG_CARRY : next.flags & ~FLAG_CARRY;
      next.accumulator = previous >>> 1;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      return { blocked: false, status: next.status, closesEpoch: false };
    }
    case SYS.INC: {
      const previous = next.accumulator;
      next.accumulator = (previous + 1) & NIBBLE_MASK;
      next.flags = previous === NIBBLE_MASK ? next.flags | FLAG_CARRY : next.flags & ~FLAG_CARRY;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      return { blocked: false, status: next.status, closesEpoch: false };
    }
    case SYS.DEC: {
      const previous = next.accumulator;
      next.accumulator = (previous - 1) & NIBBLE_MASK;
      next.flags = previous !== 0 ? next.flags | FLAG_CARRY : next.flags & ~FLAG_CARRY;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      return { blocked: false, status: next.status, closesEpoch: false };
    }
    case SYS.IN: {
      const port = instruction.port;
      if (port === undefined || port >= MAX_PORTS) throw new V2ExecutionError("INVALID_INSTRUCTION", "IN port is invalid");
      const candidate = next.inbox
        .filter((record) => !record.consumed && record.destinationEpoch === next.epoch && record.destinationPort === port)
        .sort(compareInputs)[0];
      if (candidate === undefined) {
        return {
          blocked: true,
          status: STATUS.waitingInput,
          stopReason: STOP_REASON.inputUnavailable,
          closesEpoch: false,
        };
      }
      const index = next.inbox.findIndex((record) => record.outputId === candidate.outputId);
      const consumed = next.inbox[index];
      if (index < 0 || consumed === undefined) throw new V2ExecutionError("ARCHITECTURAL_INVARIANT", "input cursor disappeared");
      const updated: InputRecord = { ...consumed, consumed: true };
      next.inbox[index] = updated;
      next.inbox.sort(compareInputs);
      next.accumulator = updated.value;
      next.flags = setZeroFlag(next.flags, next.accumulator);
      next.inputCommitment = nextInputCommitment(next.inputCommitment, updated);
      return { blocked: false, status: next.status, closesEpoch: false };
    }
    case SYS.OUTP: {
      const port = instruction.port;
      if (port === undefined || port >= MAX_PORTS) throw new V2ExecutionError("INVALID_INSTRUCTION", "OUTP port is invalid");
      const limit = next.config.maxOutputRecords ?? MAX_OUTPUT_RECORDS;
      if (next.outbox.length >= limit) {
        return {
          blocked: true,
          status: STATUS.backpressured,
          stopReason: STOP_REASON.outputBackpressure,
          closesEpoch: false,
        };
      }
      const route = next.config.routes.find((candidate) => candidate.sourceCoreId === next.config.coreId && candidate.sourcePort === port);
      if (route === undefined) throw new V2ExecutionError("INVALID_ROUTE", `no route configured for output port ${port}`);
      const sequence = next.nextOutputSequence[port];
      if (sequence === undefined || sequence >= 0xff) throw new V2ExecutionError("INVALID_SEQUENCE", "output sequence exhausted");
      const recordBase: Omit<OutputRecord, "outputId"> = {
        sourceCoreId: next.config.coreId,
        destinationCoreId: route.destinationCoreId,
        sourceEpoch: next.epoch,
        destinationEpoch: next.epoch + BigInt(route.delay),
        sourcePort: port,
        destinationPort: route.destinationPort,
        sequence,
        value: next.accumulator,
        sourceInstructionCount: before.instructionCount + 1n,
        sourceStateHash: beforeStateHash,
      };
      const record: OutputRecord = {
        ...recordBase,
        outputId: outputId(next.config.runId, recordBase),
      };
      next.outbox.push(record);
      next.nextOutputSequence[port] = sequence + 1;
      return { blocked: false, status: next.status, output: record, closesEpoch: false };
    }
    case SYS.YIELD:
      return { blocked: false, status: next.status, stopReason: STOP_REASON.yielded, closesEpoch: true };
    case SYS.TRAP:
      next.status = STATUS.faulted;
      next.faultCode = instruction.trapCode ?? 0;
      return { blocked: false, status: next.status, stopReason: STOP_REASON.faulted, closesEpoch: false };
    default:
      throw new V2ExecutionError("INVALID_INSTRUCTION", `unsupported SYS suboperation ${String(subop)}`);
  }
}

function validateDeliveryEnvelope(state: V2State, message: DeliverInputMessage, authenticatedSourceCoreId: number): void {
  if (message.runId.toLowerCase() !== state.config.runId.toLowerCase()) {
    throw new V2ExecutionError("INVALID_RUN", "input run ID does not match state");
  }
  if (authenticatedSourceCoreId !== message.sourceCoreId) {
    throw new V2ExecutionError("UNAUTHORIZED_PEER", "input sender is not the claimed source core");
  }
  if (message.destinationCoreId !== state.config.coreId) {
    throw new V2ExecutionError("UNAUTHORIZED_PEER", "input is addressed to another core");
  }
  if (message.destinationEpoch < state.epoch || message.destinationEpoch > state.epoch + 1n) {
    throw new V2ExecutionError("INVALID_EPOCH", "input is outside the two-epoch acceptance window");
  }
  if (message.sourcePort < 0 || message.sourcePort >= MAX_PORTS || message.destinationPort < 0 || message.destinationPort >= MAX_PORTS) {
    throw new V2ExecutionError("INVALID_ROUTE", "input port is outside the v2 range");
  }
  if (message.value < 0 || message.value > NIBBLE_MASK || message.sequence < 0 || message.sequence > 0xff) {
    throw new V2ExecutionError("INVALID_SEQUENCE", "input payload or sequence is outside the v2 range");
  }
  const route = state.config.routes.find(
    (candidate) =>
      candidate.sourceCoreId === message.sourceCoreId &&
      candidate.sourcePort === message.sourcePort &&
      candidate.destinationCoreId === message.destinationCoreId &&
      candidate.destinationPort === message.destinationPort,
  );
  if (route === undefined || message.destinationEpoch !== message.sourceEpoch + BigInt(route.delay) || message.sequence >= route.maxRecordsPerEpoch) {
    throw new V2ExecutionError("INVALID_ROUTE", "input does not match the immutable route table");
  }
  const expectedId = outputId(state.config.runId, {
    sourceCoreId: message.sourceCoreId,
    destinationCoreId: message.destinationCoreId,
    sourceEpoch: message.sourceEpoch,
    destinationEpoch: message.destinationEpoch,
    sourcePort: message.sourcePort,
    destinationPort: message.destinationPort,
    sequence: message.sequence,
    value: message.value,
    sourceInstructionCount: message.sourceInstructionCount,
    sourceStateHash: message.sourceStateHash,
  });
  if (expectedId !== message.outputId.toLowerCase()) {
    throw new V2ExecutionError("INVALID_ROUTE", "input output identifier does not match its canonical fields");
  }
}

function makeAcknowledgement(state: V2State, message: DeliverInputMessage): InputAcknowledgement {
  const acknowledgement: InputAcknowledgement = {
    runId: state.config.runId,
    outputId: message.outputId.toLowerCase(),
    destinationCoreId: state.config.coreId,
    destinationEpoch: message.destinationEpoch,
    destinationStateHash: stateHash(state),
  };
  if (message.queryId !== undefined) {
    (acknowledgement as { queryId: bigint }).queryId = message.queryId;
  }
  return acknowledgement;
}

function sameInput(record: InputRecord, message: DeliverInputMessage): boolean {
  return (
    record.sourceCoreId === message.sourceCoreId &&
    record.destinationCoreId === message.destinationCoreId &&
    record.sourceEpoch === message.sourceEpoch &&
    record.destinationEpoch === message.destinationEpoch &&
    record.sourcePort === message.sourcePort &&
    record.destinationPort === message.destinationPort &&
    record.sequence === message.sequence &&
    record.value === message.value &&
    record.sourceInstructionCount === message.sourceInstructionCount &&
    record.sourceStateHash === message.sourceStateHash
  );
}

function assertStepLimit(value: number, configuredMaximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > configuredMaximum || value > 0xffff) {
    throw new V2ExecutionError("INVALID_BODY", "requested instruction batch is outside the configured bound");
  }
}

function assertOutputLimit(value: number, configuredMaximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > configuredMaximum || value > MAX_OUTPUT_RECORDS) {
    throw new V2ExecutionError("INVALID_BODY", "requested output event bound is outside the configured bound");
  }
}

function hasAvailableInput(state: V2State, epoch: bigint): boolean {
  return state.inbox.some((record) => !record.consumed && record.destinationEpoch === epoch);
}

function isEpochReady(state: V2State, epoch: bigint): boolean {
  return state.config.requiredInputs.every((quota) => {
    const available = state.inbox.filter(
      (record) => !record.consumed && record.destinationEpoch === epoch && record.destinationPort === quota.port,
    ).length;
    return available >= quota.count;
  });
}

function compareInputs(a: InputRecord, b: InputRecord): number {
  return compareBigInt(a.destinationEpoch, b.destinationEpoch) || a.destinationPort - b.destinationPort || a.sequence - b.sequence;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function readRegister(state: V2State, index: number): number {
  const value = state.registers[index];
  if (value === undefined) throw new V2ExecutionError("ARCHITECTURAL_INVARIANT", `register ${index} is unavailable`);
  return value;
}

function writeRegister(state: V2State, index: number, value: number): void {
  if (state.registers[index] === undefined) throw new V2ExecutionError("ARCHITECTURAL_INVARIANT", `register ${index} is unavailable`);
  state.registers[index] = value & NIBBLE_MASK;
}

function readRam(state: V2State, address: number): number {
  const value = state.ram[address];
  if (value === undefined) throw new V2ExecutionError("ARCHITECTURAL_INVARIANT", `RAM address ${address} is unavailable`);
  return value;
}

function writeRam(state: V2State, address: number, value: number): void {
  if (state.ram[address] === undefined) throw new V2ExecutionError("ARCHITECTURAL_INVARIANT", `RAM address ${address} is unavailable`);
  state.ram[address] = value & NIBBLE_MASK;
}

function add(state: V2State, operand: number, includeCarry: boolean): void {
  const carry = includeCarry && hasFlag(state.flags, FLAG_CARRY) ? 1 : 0;
  const sum = state.accumulator + operand + carry;
  state.accumulator = sum & NIBBLE_MASK;
  state.flags = sum >= 16 ? state.flags | FLAG_CARRY : state.flags & ~FLAG_CARRY;
  state.flags = setZeroFlag(state.flags, state.accumulator);
}

function subtract(state: V2State, operand: number): void {
  const before = state.accumulator;
  state.accumulator = (before - operand) & NIBBLE_MASK;
  state.flags = before >= operand ? state.flags | FLAG_CARRY : state.flags & ~FLAG_CARRY;
  state.flags = setZeroFlag(state.flags, state.accumulator);
}

function logical(state: V2State, value: number): void {
  state.accumulator = value & NIBBLE_MASK;
  state.flags &= ~FLAG_CARRY;
  state.flags = setZeroFlag(state.flags, state.accumulator);
}

function setZeroFlag(flags: number, value: number): number {
  return value === 0 ? flags | FLAG_ZERO : flags & ~FLAG_ZERO;
}

function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}
