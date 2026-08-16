export const NIBBLE_MASK = 0x0f;
export const REGISTER_COUNT = 16;
export const RAM_SIZE = 256;
export const ROM_WORDS = 1024;
export const WORD_BITS = 16;
export const WORD_MASK = (1 << WORD_BITS) - 1;
export const PC_MASK = ROM_WORDS - 1;
export const ADDRESS8_MASK = 0xff;
export const FLAG_ZERO = 1;
export const FLAG_CARRY = 2;
export const STATUS_RUNNING = "running" as const;
export const STATUS_HALTED = "halted" as const;
export const STATIC_COMMITMENT_NAMESPACE = 0x544e4c01;
export const SCHEMA_VERSION = 1;
export const ISA_VERSION = 1;
export const OUTPUT_COMMITMENT_DOMAIN = 0x544e4c4f;

export const MESSAGE_PREFIX = {
  advance: 0x544e4c01,
  topUp: 0x544e4c02,
  cpuAdvanced: 0x544e4c81,
  cpuOutput: 0x544e4c82,
} as const;

export const EXIT_CODE = {
  unknownMessage: 100,
  halted: 101,
  staleAdvance: 102,
  stateHashMismatch: 103,
  invalidStepCount: 104,
  insufficientValue: 105,
  nonCanonicalInstruction: 106,
  invalidSysSubop: 107,
  invalidStorage: 108,
  externalMessageRejected: 109,
} as const;

export const MAX_STEPS_PER_ADVANCE = 1;
