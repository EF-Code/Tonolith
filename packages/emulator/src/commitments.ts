import { beginCell, type Cell } from "@ton/core";
import { DOMAIN, STATUS } from "../../isa/src/constants.js";
import {
  assertHash,
  assertInteger,
  assertNibble,
  type Hash256,
  type InputRecord,
  type OutputRecord,
  type Route,
  type V2State,
  zeroHash,
} from "./model.js";

export function hashHex(cell: Cell): Hash256 {
  return cell.hash().toString("hex");
}

export function hashBigInt(cell: Cell): bigint {
  return BigInt(`0x${hashHex(cell)}`);
}

export function toBigInt(hash: Hash256): bigint {
  assertHash(hash, "hash");
  return BigInt(`0x${hash}`);
}

export function hashField(builder: ReturnType<typeof beginCell>, hash: Hash256): ReturnType<typeof beginCell> {
  return builder.storeUint(toBigInt(hash), 256);
}

export function programCommitmentCell(
  artifactVersion: number,
  isaVersion: number,
  wordBits: number,
  romWords: number,
  ramNibbles: number,
  entryPc: number,
  romRoot: Hash256,
  initialRamRoot: Hash256,
): Cell {
  return hashField(
    beginCell()
      .storeUint(DOMAIN.program, 32)
      .storeUint(artifactVersion, 16)
      .storeUint(isaVersion, 16)
      .storeUint(wordBits, 8)
      .storeUint(romWords, 16)
      .storeUint(ramNibbles, 16)
      .storeUint(entryPc, 16),
    romRoot,
  ).storeUint(toBigInt(initialRamRoot), 256).endCell();
}

export interface ProgramCommitmentFields {
  artifactVersion: number;
  isaVersion: number;
  wordBits: number;
  romWords: number;
  ramNibbles: number;
  entryPc: number;
  romRoot: Hash256;
  initialRamRoot: Hash256;
}

export function programId(fields: ProgramCommitmentFields): Hash256 {
  return hashHex(programCommitmentCell(
    fields.artifactVersion,
    fields.isaVersion,
    fields.wordBits,
    fields.romWords,
    fields.ramNibbles,
    fields.entryPc,
    fields.romRoot,
    fields.initialRamRoot,
  ));
}

export function staticCommitmentCell(fields: {
  schemaVersion: number;
  isaVersion: number;
  abiVersion: number;
  protocolVersion: number;
  runId: Hash256;
  coreId: number;
  programId: Hash256;
  romRoot: Hash256;
  routeRoot: Hash256;
  limitsHash: Hash256;
}): Cell {
  const programPayload = beginCell()
    .storeUint(toBigInt(fields.programId), 256)
    .storeUint(toBigInt(fields.romRoot), 256)
    .storeUint(toBigInt(fields.routeRoot), 256)
    .endCell();
  const limitsPayload = beginCell().storeUint(toBigInt(fields.limitsHash), 256).endCell();
  return beginCell()
      .storeUint(DOMAIN.static, 32)
      .storeUint(fields.schemaVersion, 16)
      .storeUint(fields.isaVersion, 16)
      .storeUint(fields.abiVersion, 16)
      .storeUint(fields.protocolVersion, 16)
      .storeUint(toBigInt(fields.runId), 256)
      .storeUint(fields.coreId, 16)
      .storeRef(programPayload)
      .storeRef(limitsPayload)
      .endCell();
}

export function outputRecordCell(record: OutputRecord): Cell {
  return beginCell()
    .storeUint(DOMAIN.output, 32)
    .storeUint(toBigInt(record.outputId), 256)
    .storeUint(record.sourceCoreId, 16)
    .storeUint(record.destinationCoreId, 16)
    .storeUint(record.sourceEpoch, 64)
    .storeUint(record.destinationEpoch, 64)
    .storeUint(record.sourcePort, 4)
    .storeUint(record.destinationPort, 4)
    .storeUint(record.sequence, 8)
    .storeUint(record.value, 4)
    .storeUint(record.sourceInstructionCount, 64)
    .storeUint(toBigInt(record.sourceStateHash), 256)
    .endCell();
}

export function inputRecordCell(record: InputRecord): Cell {
  return beginCell()
    .storeUint(DOMAIN.input, 32)
    .storeUint(toBigInt(record.outputId), 256)
    .storeUint(record.sourceCoreId, 16)
    .storeUint(record.destinationCoreId, 16)
    .storeUint(record.sourceEpoch, 64)
    .storeUint(record.destinationEpoch, 64)
    .storeUint(record.sourcePort, 4)
    .storeUint(record.destinationPort, 4)
    .storeUint(record.sequence, 8)
    .storeUint(record.value, 4)
    .storeUint(record.sourceInstructionCount, 64)
    .storeUint(toBigInt(record.sourceStateHash), 256)
    .storeBit(record.consumed)
    .endCell();
}

export function routeCell(route: Route): Cell {
  return beginCell()
    .storeUint(DOMAIN.route, 32)
    .storeUint(route.sourceCoreId, 16)
    .storeUint(route.sourcePort, 4)
    .storeUint(route.destinationCoreId, 16)
    .storeUint(route.destinationPort, 4)
    .storeUint(route.delay, 8)
    .storeUint(route.maxRecordsPerEpoch, 8)
    .endCell();
}

export function routeRootCell(routes: readonly Route[]): Cell {
  const sorted = [...routes].sort(compareRoutes);
  return boundedRecordRoot(sorted.map(routeCell));
}

export function routeRoot(routes: readonly Route[]): Hash256 {
  return hashHex(routeRootCell(routes));
}

export function inputRootCell(records: readonly InputRecord[]): Cell {
  const sorted = [...records].sort(compareInputs);
  return boundedRecordRoot(sorted.map(inputRecordCell));
}

export function outputRootCell(records: readonly OutputRecord[]): Cell {
  const sorted = [...records].sort(compareOutputs);
  return boundedRecordRoot(sorted.map(outputRecordCell));
}

export function registersCell(registers: readonly number[]): Cell {
  if (registers.length !== 16) throw new RangeError("register file must contain 16 entries");
  let packed = 0n;
  registers.forEach((value, index) => {
    assertNibble(value, `register ${index}`);
    packed |= BigInt(value) << BigInt(index * 4);
  });
  return beginCell().storeUint(packed, 64).endCell();
}

export function ramRootCell(ram: Uint8Array): Cell {
  if (ram.length !== 256) throw new RangeError("RAM must contain 256 nibbles");
  const pages = Array.from({ length: 4 }, (_, page) => {
    let packed = 0n;
    for (let offset = 0; offset < 64; offset += 1) {
      const value = ram[page * 64 + offset] ?? 0;
      assertNibble(value, `RAM ${page * 64 + offset}`);
      packed |= BigInt(value) << BigInt(offset * 4);
    }
    return beginCell().storeUint(packed, 256).endCell();
  });
  return beginCell()
    .storeRef(pages[0]!)
    .storeRef(pages[1]!)
    .storeRef(pages[2]!)
    .storeRef(pages[3]!)
    .endCell();
}

export function nextOutputCommitment(previous: Hash256, record: OutputRecord): Hash256 {
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.output, 32)
      .storeUint(toBigInt(previous), 256)
      .storeUint(toBigInt(record.outputId), 256)
      .storeUint(record.sourceInstructionCount, 64)
      .storeUint(record.value, 4)
      .endCell(),
  );
}

export function nextLegacyOutputCommitment(
  previous: Hash256,
  outputIndex: bigint,
  instructionCount: bigint,
  value: number,
): Hash256 {
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.output, 32)
      .storeUint(toBigInt(previous), 256)
      .storeUint(outputIndex, 64)
      .storeUint(instructionCount, 64)
      .storeUint(value, 4)
      .endCell(),
  );
}

export function nextInputCommitment(previous: Hash256, record: InputRecord): Hash256 {
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.input, 32)
      .storeUint(toBigInt(previous), 256)
      .storeUint(toBigInt(record.outputId), 256)
      .storeUint(record.destinationEpoch, 64)
      .storeUint(record.sequence, 8)
      .storeUint(record.value, 4)
      .storeBit(record.consumed)
      .endCell(),
  );
}

export function nextEpochCommitment(
  previous: Hash256,
  epoch: bigint,
  stateHash: Hash256,
  outputCommitment: Hash256,
  inputCommitment: Hash256,
): Hash256 {
  const epochPayload = beginCell()
    .storeUint(toBigInt(stateHash), 256)
    .storeUint(toBigInt(outputCommitment), 256)
    .storeUint(toBigInt(inputCommitment), 256)
    .endCell();
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.epoch, 32)
      .storeUint(toBigInt(previous), 256)
      .storeUint(epoch, 64)
      .storeRef(epochPayload)
      .endCell(),
  );
}

export function outputId(runId: Hash256, record: Omit<OutputRecord, "outputId">): Hash256 {
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.output, 32)
      .storeUint(toBigInt(runId), 256)
      .storeUint(toBigInt(record.sourceStateHash), 256)
      .storeUint(record.sourceCoreId, 16)
      .storeUint(record.destinationCoreId, 16)
      .storeUint(record.sourceEpoch, 64)
      .storeUint(record.destinationEpoch, 64)
      .storeUint(record.sourcePort, 4)
      .storeUint(record.destinationPort, 4)
      .storeUint(record.sequence, 8)
      .storeUint(record.value, 4)
      .storeUint(record.sourceInstructionCount, 64)
      .endCell(),
  );
}

export function nextAcknowledgedOutputCommitment(previous: Hash256, outputIdValue: Hash256): Hash256 {
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.acknowledgement, 32)
      .storeUint(toBigInt(previous), 256)
      .storeUint(toBigInt(outputIdValue), 256)
      .endCell(),
  );
}

export function traceCommitment(
  previous: Hash256,
  instructionWord: number,
  nextStateHash: Hash256,
): Hash256 {
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.batch, 32)
      .storeUint(toBigInt(previous), 256)
      .storeUint(instructionWord, 16)
      .storeUint(toBigInt(nextStateHash), 256)
      .endCell(),
  );
}

export function batchCommitment(fields: {
  previousStateHash: Hash256;
  nextStateHash: Hash256;
  startInstructionCount: bigint;
  endInstructionCount: bigint;
  stepsExecuted: number;
  outputsProduced: number;
  stopReason: number;
  traceCommitment: Hash256;
}): Hash256 {
  const detail = beginCell()
    .storeUint(toBigInt(fields.previousStateHash), 256)
    .storeUint(toBigInt(fields.nextStateHash), 256)
    .storeUint(fields.startInstructionCount, 64)
    .storeUint(fields.endInstructionCount, 64)
    .storeUint(fields.stepsExecuted, 16)
    .storeUint(fields.outputsProduced, 8)
    .storeUint(fields.stopReason, 8)
    .storeUint(toBigInt(fields.traceCommitment), 256)
    .endCell();
  return hashHex(
    beginCell()
      .storeUint(DOMAIN.batch, 32)
      .storeRef(detail)
      .endCell(),
  );
}

export function coreStateCell(state: V2State): Cell {
  assertStateForHash(state);
  const commitmentCell = beginCell()
    .storeUint(toBigInt(state.outputCommitment), 256)
    .storeUint(toBigInt(state.inputCommitment), 256)
    .storeUint(toBigInt(state.epochHistoryCommitment), 256)
    .endCell();
  const memoryCell = beginCell()
    .storeRef(registersCell(state.registers))
    .storeRef(ramRootCell(state.ram))
    .endCell();
  const queueCell = beginCell()
    .storeRef(inputRootCell(state.inbox))
    .storeRef(outputRootCell(state.outbox))
    .endCell();
  return beginCell()
    .storeUint(DOMAIN.state, 32)
    .storeUint(toBigInt(state.config.staticCommitment), 256)
    .storeUint(state.status, 3)
    .storeUint(state.faultCode, 8)
    .storeUint(state.pc, 10)
    .storeUint(state.accumulator, 4)
    .storeUint(state.flags, 2)
    .storeUint(state.epoch, 64)
    .storeUint(state.instructionCount, 64)
    .storeUint(state.advanceCount, 64)
    .storeUint(state.acceptedMessageCount, 64)
    .storeUint(state.outputCount, 64)
    .storeUint(state.inputCount, 64)
    .storeUint(packSequences(state.nextOutputSequence), 128)
    .storeRef(commitmentCell)
    .storeRef(memoryCell)
    .storeRef(queueCell)
    .endCell();
}

export function stateHash(state: V2State): Hash256 {
  return hashHex(coreStateCell(state));
}

function boundedRecordRoot(records: readonly Cell[]): Cell {
  if (records.length > 16) throw new RangeError("record root supports at most 16 records");
  const pages = Array.from({ length: 4 }, (_, pageIndex) => {
    const builder = beginCell().storeUint(Math.min(Math.max(records.length - pageIndex * 4, 0), 4), 3);
    for (let offset = 0; offset < 4; offset += 1) {
      const record = records[pageIndex * 4 + offset];
      if (record !== undefined) builder.storeRef(record);
    }
    return builder.endCell();
  });
  return beginCell()
    .storeUint(records.length, 5)
    .storeRef(pages[0]!)
    .storeRef(pages[1]!)
    .storeRef(pages[2]!)
    .storeRef(pages[3]!)
    .endCell();
}

function packSequences(sequences: readonly number[]): bigint {
  if (sequences.length !== 16) throw new RangeError("sequence table must contain 16 entries");
  return sequences.reduce((packed, sequence, index) => {
    assertInteger(sequence, 0, 255, `sequence ${index}`);
    return packed | (BigInt(sequence) << BigInt(index * 8));
  }, 0n);
}

function assertStateForHash(state: V2State): void {
  assertInteger(state.status, STATUS.running, STATUS.faulted, "status");
  assertInteger(state.pc, 0, 1023, "pc");
  assertInteger(state.faultCode, 0, 255, "faultCode");
  assertNibble(state.accumulator, "accumulator");
  assertInteger(state.flags, 0, 3, "flags");
  [state.config.staticCommitment, state.outputCommitment, state.inputCommitment, state.epochHistoryCommitment]
    .forEach((hash) => assertHash(hash, "commitment"));
  if (
    state.epoch < 0n ||
    state.instructionCount < 0n ||
    state.advanceCount < 0n ||
    state.acceptedMessageCount < 0n ||
    state.outputCount < 0n ||
    state.inputCount < 0n
  ) {
    throw new RangeError("state counters must be unsigned");
  }
}

function compareRoutes(a: Route, b: Route): number {
  return a.sourceCoreId - b.sourceCoreId || a.sourcePort - b.sourcePort || a.destinationCoreId - b.destinationCoreId || a.destinationPort - b.destinationPort;
}

function compareInputs(a: InputRecord, b: InputRecord): number {
  return compareBigInt(a.destinationEpoch, b.destinationEpoch) || a.destinationPort - b.destinationPort || a.sequence - b.sequence;
}

function compareOutputs(a: OutputRecord, b: OutputRecord): number {
  return compareBigInt(a.sourceEpoch, b.sourceEpoch) || a.sourcePort - b.sourcePort || a.sequence - b.sequence;
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const EMPTY_COMMITMENT = zeroHash();
