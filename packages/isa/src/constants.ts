/** Versioned constants mirrored from spec/v2/protocol.json. */
export const SCHEMA_VERSION = 2 as const;
export const ISA_VERSION = 2 as const;
export const ABI_VERSION = 2 as const;
export const PROTOCOL_VERSION = 2 as const;
export const TONOLITH_MAGIC = 0x544e4c32 as const;

export const WORD_BITS = 16 as const;
export const ROM_WORDS = 1024 as const;
export const RAM_NIBBLES = 256 as const;
export const MAX_PORTS = 16 as const;
export const MAX_INPUT_RECORDS = 16 as const;
export const MAX_OUTPUT_RECORDS = 16 as const;
export const MAX_RECORDS_PER_EPOCH = 16 as const;
export const MAX_REPLAY_EPOCHS = 2 as const;
export const MAX_ACTIONS_PER_ADVANCE = 32 as const;
export const INITIAL_MAX_STEPS_PER_ADVANCE = 1 as const;
export const PROJECT_GAS_CEILING = 400_000 as const;

export const DOMAIN = {
  program: 0x544c5032,
  static: 0x544c5332,
  state: 0x544c4332,
  epoch: 0x544c4532,
  output: 0x544c4f32,
  input: 0x544c4932,
  route: 0x544c5232,
  batch: 0x544c4232,
  acknowledgement: 0x544c4132,
} as const;

export const MESSAGE_PREFIX = {
  advance: 0x544e4c21,
  dispatchOutput: 0x544e4c22,
  deliverInput: 0x544e4c23,
  inputAccepted: 0x544e4c24,
  topUp: 0x544e4c25,
} as const;

export const EVENT_PREFIX = {
  batchAdvanced: 0x544e4ca1,
  outputCommitted: 0x544e4ca2,
  inputCommitted: 0x544e4ca3,
  outputAcknowledged: 0x544e4ca4,
} as const;

export const STATUS = {
  running: 0,
  waitingInput: 1,
  backpressured: 2,
  halted: 3,
  faulted: 4,
} as const;

export const STOP_REASON = {
  requestLimit: 0,
  halted: 1,
  faulted: 2,
  inputUnavailable: 3,
  outputBackpressure: 4,
  yielded: 5,
  outputEventLimit: 6,
} as const;

export const SYS = {
  HALT: 0,
  OUT: 1,
  CLC: 2,
  STC: 3,
  NOT: 4,
  SHL: 5,
  SHR: 6,
  INC: 7,
  DEC: 8,
  IN: 9,
  OUTP: 10,
  YIELD: 11,
  TRAP: 12,
} as const;

export const ERROR = {
  unknownMessage: 100,
  invalidAbi: 101,
  invalidVersion: 102,
  invalidBody: 103,
  invalidValue: 104,
  staleAdvance: 120,
  stateHashMismatch: 121,
  invalidRun: 122,
  invalidStaticCommitment: 123,
  invalidStatus: 124,
  invalidInstruction: 140,
  invalidPc: 141,
  architecturalInvariant: 142,
  unauthorizedPeer: 160,
  invalidRoute: 161,
  invalidEpoch: 162,
  invalidSequence: 163,
  conflictingReplay: 164,
  queueFull: 165,
  notFound: 166,
  insufficientReserve: 180,
  insufficientValue: 181,
  invalidStorage: 190,
  externalMessageRejected: 191,
} as const;

export type CoreStatus = (typeof STATUS)[keyof typeof STATUS];
export type StopReason = (typeof STOP_REASON)[keyof typeof STOP_REASON];
