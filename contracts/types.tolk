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

struct RamRoot {
    page0: Cell<RamPage>
    page1: Cell<RamPage>
    page2: Cell<RamPage>
    page3: Cell<RamPage>
}

struct CoreState {
    advanceCount: uint64
    instructionCount: uint64
    outputCount: uint64
    pc: uint10
    accumulator: uint4
    flags: uint2
    status: uint1
    outputRegister: uint4
    registers: uint64
    outputCommitment: uint256
    ram: Cell<RamRoot>
}

struct RomLeaf {
    firstHalf: uint256
    secondHalf: uint256
}

struct RomLevel1 {
    leaf0: Cell<RomLeaf>
    leaf1: Cell<RomLeaf>
    leaf2: Cell<RomLeaf>
    leaf3: Cell<RomLeaf>
}

struct RomLevel2 {
    level10: Cell<RomLevel1>
    level11: Cell<RomLevel1>
    level12: Cell<RomLevel1>
    level13: Cell<RomLevel1>
}

struct RomRoot {
    level20: Cell<RomLevel2>
    level21: Cell<RomLevel2>
    level22: Cell<RomLevel2>
    level23: Cell<RomLevel2>
}

struct StaticCommitmentPreimage {
    namespace: uint32
    schemaVersion: uint16
    isaVersion: uint16
    romRoot: uint256
}

struct OutputCommitmentPreimage {
    namespace: uint32
    previousCommitment: uint256
    outputIndex: uint64
    instructionCount: uint64
    value: uint4
}

struct Storage {
    magic: uint32
    schemaVersion: uint16
    isaVersion: uint16
    staticCommitment: uint256
    // Both roots are stored as raw references at the root boundary. Runtime
    // code casts and decodes CoreState exactly once before execution.
    core: cell
    // ROM is immutable and validated by its committed hash before execution.
    // Keep this root untyped at the storage boundary so serialization does not
    // recursively revalidate the entire fixed ROM tree on every state save.
    rom: cell
}

fun Storage.load(): Storage {
    return Storage.fromCell(contract.getData());
}

