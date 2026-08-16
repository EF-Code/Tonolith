enum Errors {
    UnknownMessage = 100
    Halted = 101
    StaleAdvance = 102
    StateHashMismatch = 103
    InvalidStepCount = 104
    InsufficientValue = 105
    NonCanonicalInstruction = 106
    InvalidSysSubop = 107
    InvalidStorage = 108
    ExternalMessageRejected = 109
}

const TONOLITH_MAGIC: uint32 = 0x544E4C31
const SCHEMA_VERSION: uint16 = 1
const ISA_VERSION: uint16 = 1
const STATIC_NAMESPACE: uint32 = 0x544E4C01

const FLAG_ZERO: uint2 = 1
const FLAG_CARRY: uint2 = 2
const STATUS_RUNNING: uint1 = 0
const STATUS_HALTED: uint1 = 1
const OUTPUT_NAMESPACE: uint32 = 0x544E4C4F
const MAX_STEPS_PER_ADVANCE: uint16 = 1

struct RamPage {
    packed: uint256
}

