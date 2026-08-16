import {
  MAX_INPUT_RECORDS,
  MAX_OUTPUT_RECORDS,
  MAX_PORTS,
  RAM_NIBBLES,
  ROM_WORDS,
  STATUS,
  type CoreStatus,
} from "../../isa/src/constants.js";

export type Hash256 = string;

export interface Route {
  readonly sourceCoreId: number;
  readonly sourcePort: number;
  readonly destinationCoreId: number;
  readonly destinationPort: number;
  readonly delay: number;
  readonly maxRecordsPerEpoch: number;
}

export interface InputQuota {
  readonly port: number;
  readonly count: number;
}

export interface CoreConfig {
  readonly runId: Hash256;
  readonly coreId: number;
  readonly programId: Hash256;
  readonly romRoot: Hash256;
  readonly initialRamRoot: Hash256;
  readonly routeRoot: Hash256;
  readonly staticCommitment: Hash256;
  readonly routes: readonly Route[];
  readonly requiredInputs: readonly InputQuota[];
  readonly maxStepsPerAdvance: number;
  readonly maxInputRecords?: number;
  readonly maxOutputRecords?: number;
}

export interface InputRecord {
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
  readonly consumed: boolean;
}

export interface OutputRecord {
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

export interface LegacyOutput {
  readonly outputIndex: bigint;
  readonly instructionCount: bigint;
  readonly value: number;
  readonly outputCommitment: Hash256;
}

export interface V2State {
  readonly config: CoreConfig;
  advanceCount: bigint;
  instructionCount: bigint;
  outputCount: bigint;
  inputCount: bigint;
  epoch: bigint;
  pc: number;
  accumulator: number;
  flags: number;
  status: CoreStatus;
  faultCode: number;
  registers: number[];
  ram: Uint8Array;
  outputCommitment: Hash256;
  inputCommitment: Hash256;
  epochHistoryCommitment: Hash256;
  nextOutputSequence: number[];
  inbox: InputRecord[];
  outbox: OutputRecord[];
}

export function createInitialState(config: CoreConfig): V2State {
  validateConfig(config);
  return {
    config,
    advanceCount: 0n,
    instructionCount: 0n,
    outputCount: 0n,
    inputCount: 0n,
    epoch: 0n,
    pc: 0,
    accumulator: 0,
    flags: 0,
    status: STATUS.running,
    faultCode: 0,
    registers: Array.from({ length: 16 }, () => 0),
    ram: new Uint8Array(RAM_NIBBLES),
    outputCommitment: zeroHash(),
    inputCommitment: zeroHash(),
    epochHistoryCommitment: zeroHash(),
    nextOutputSequence: Array.from({ length: MAX_PORTS }, () => 0),
    inbox: [],
    outbox: [],
  };
}

export function cloneState(state: V2State): V2State {
  return {
    ...state,
    config: {
      ...state.config,
      routes: state.config.routes.map((route) => ({ ...route })),
      requiredInputs: state.config.requiredInputs.map((quota) => ({ ...quota })),
    },
    registers: [...state.registers],
    ram: state.ram.slice(),
    nextOutputSequence: [...state.nextOutputSequence],
    inbox: state.inbox.map((record) => ({ ...record })),
    outbox: state.outbox.map((record) => ({ ...record })),
  };
}

export function zeroHash(): Hash256 {
  return "0".repeat(64);
}

export function validateConfig(config: CoreConfig): void {
  assertHash(config.runId, "runId");
  assertHash(config.programId, "programId");
  assertHash(config.romRoot, "romRoot");
  assertHash(config.initialRamRoot, "initialRamRoot");
  assertHash(config.routeRoot, "routeRoot");
  assertHash(config.staticCommitment, "staticCommitment");
  assertInteger(config.coreId, 0, 0xffff, "coreId");
  assertInteger(config.maxStepsPerAdvance, 1, 0xffff, "maxStepsPerAdvance");
  assertInteger(config.maxInputRecords ?? MAX_INPUT_RECORDS, 0, MAX_INPUT_RECORDS, "maxInputRecords");
  assertInteger(config.maxOutputRecords ?? MAX_OUTPUT_RECORDS, 0, MAX_OUTPUT_RECORDS, "maxOutputRecords");
  const seenPorts = new Set<number>();
  for (const quota of config.requiredInputs) {
    assertInteger(quota.port, 0, MAX_PORTS - 1, "input port");
    assertInteger(quota.count, 0, MAX_INPUT_RECORDS, "input quota");
    if (seenPorts.has(quota.port)) throw new RangeError(`duplicate input quota port ${quota.port}`);
    seenPorts.add(quota.port);
  }
  for (const route of config.routes) {
    assertInteger(route.sourceCoreId, 0, 0xffff, "sourceCoreId");
    assertInteger(route.destinationCoreId, 0, 0xffff, "destinationCoreId");
    assertInteger(route.sourcePort, 0, MAX_PORTS - 1, "sourcePort");
    assertInteger(route.destinationPort, 0, MAX_PORTS - 1, "destinationPort");
    assertInteger(route.delay, 1, 0xff, "route delay");
    assertInteger(route.maxRecordsPerEpoch, 1, MAX_INPUT_RECORDS, "route record quota");
  }
}

export function assertHash(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new RangeError(`${field} must be a 256-bit hex value`);
}

export function assertInteger(value: number, minimum: number, maximum: number, field: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be an integer in ${minimum}..${maximum}`);
  }
}

export function assertNibble(value: number, field: string): void {
  assertInteger(value, 0, 15, field);
}

export function assertStateBounds(state: V2State): void {
  assertInteger(state.pc, 0, ROM_WORDS - 1, "pc");
  assertNibble(state.accumulator, "accumulator");
  assertInteger(state.flags, 0, 3, "flags");
  assertInteger(state.faultCode, 0, 0xff, "faultCode");
  if (state.registers.length !== 16) throw new RangeError("register file must contain 16 entries");
  state.registers.forEach((value, index) => assertNibble(value, `register ${index}`));
  if (state.ram.length !== RAM_NIBBLES) throw new RangeError("RAM must contain 256 nibbles");
  state.ram.forEach((value, index) => assertNibble(value, `RAM ${index}`));
  if (state.nextOutputSequence.length !== MAX_PORTS) throw new RangeError("sequence table must contain 16 ports");
  state.nextOutputSequence.forEach((value, index) => assertInteger(value, 0, 255, `sequence ${index}`));
  if (state.inbox.length > (state.config.maxInputRecords ?? MAX_INPUT_RECORDS)) throw new RangeError("inbox full");
  if (state.outbox.length > (state.config.maxOutputRecords ?? MAX_OUTPUT_RECORDS)) throw new RangeError("outbox full");
}
