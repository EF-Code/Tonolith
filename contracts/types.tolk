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

fun Storage.save(self) {
    contract.setData(self.toCell());
}

struct (0x544E4C01) Advance {
    queryId: uint64
    expectedAdvanceCount: uint64
    expectedStateHash: uint256
    maxInstructions: uint16
}

struct (0x544E4C02) TopUp {}

struct (0x544E4C81) CpuAdvanced {
    queryId: uint64
    advanceCount: uint64
    startInstruction: uint64
    endInstruction: uint64
    previousStateHash: uint256
    nextStateHash: uint256
    finalPc: uint10
    status: uint1
}

struct (0x544E4C82) CpuOutput {
    outputIndex: uint64
    instructionCount: uint64
    value: uint4
    outputCommitment: uint256
}

type AllowedMessage =
    | Advance
    | TopUp

fun zeroRamPage(): Cell<RamPage> {
    return RamPage { packed: 0 }.toCell();
}

fun zeroRamRoot(): Cell<RamRoot> {
    val page = zeroRamPage();
    return RamRoot {
        page0: page,
        page1: page,
        page2: page,
        page3: page,
    }.toCell();
}

fun initialCore(): Cell<CoreState> {
    return CoreState {
        advanceCount: 0,
        instructionCount: 0,
        outputCount: 0,
        pc: 0,
        accumulator: 0,
        flags: 0,
        status: STATUS_RUNNING,
        outputRegister: 0,
        registers: 0,
        outputCommitment: 0,
        ram: zeroRamRoot(),
    }.toCell();
}

fun zeroRomLeaf(): Cell<RomLeaf> {
    return RomLeaf {
        firstHalf: 0,
        secondHalf: 0,
    }.toCell();
}

fun zeroRomLevel1(): Cell<RomLevel1> {
    val leaf = zeroRomLeaf();
    return RomLevel1 {
        leaf0: leaf,
        leaf1: leaf,
        leaf2: leaf,
        leaf3: leaf,
    }.toCell();
}

fun zeroRomLevel2(): Cell<RomLevel2> {
    val level1 = zeroRomLevel1();
    return RomLevel2 {
        level10: level1,
        level11: level1,
        level12: level1,
        level13: level1,
    }.toCell();
}

fun romRootWithFirstLeaf(firstLeaf: Cell<RomLeaf>): Cell<RomRoot> {
    val zeroLeaf = zeroRomLeaf();
    val firstLevel1 = RomLevel1 {
        leaf0: firstLeaf,
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val zeroLevel1 = zeroRomLevel1();
    val firstLevel2 = RomLevel2 {
        level10: firstLevel1,
        level11: zeroLevel1,
        level12: zeroLevel1,
        level13: zeroLevel1,
    }.toCell();
    val zeroLevel2 = zeroRomLevel2();
    return RomRoot {
        level20: firstLevel2,
        level21: zeroLevel2,
        level22: zeroLevel2,
        level23: zeroLevel2,
    }.toCell();
}

fun zeroRomRoot(): Cell<RomRoot> {
    return romRootWithFirstLeaf(zeroRomLeaf());
}

fun romWord(romCell: Cell<RomRoot>, address: uint10): uint16 {
    val root = romCell.load();
    val leafIndex = address >> 5;
    val wordIndex = address & 31;
    val rootIndex = leafIndex >> 4;
    // 1,024 words contain 32 leaves, so the 4-way root uses only indexes 0 and 1.
    val level2 = rootIndex == 0 ? root.level20.load() : root.level21.load();
    val level1Index = (leafIndex >> 2) & 3;
    val level1 = selectRomLevel1(level2, level1Index);
    val leafIndexInLevel = leafIndex & 3;
    var leafCell = level1.leaf0;
    if (leafIndexInLevel == 1) {
        leafCell = level1.leaf1;
    }
    if (leafIndexInLevel == 2) {
        leafCell = level1.leaf2;
    }
    if (leafIndexInLevel == 3) {
        leafCell = level1.leaf3;
    }
    val leaf = leafCell.load();
    if (wordIndex < 16) {
        val shift = (15 - wordIndex) * 16;
        return ((leaf.firstHalf >> shift) & 0xFFFF) as uint16;
    }
    val shift = (31 - wordIndex) * 16;
    return ((leaf.secondHalf >> shift) & 0xFFFF) as uint16;
}

fun selectRomLevel1(level2: RomLevel2, index: int): RomLevel1 {
    if (index == 0) {
        return level2.level10.load();
    }
    if (index == 1) {
        return level2.level11.load();
    }
    if (index == 2) {
        return level2.level12.load();
    }
    if (index < 0 || index > 3) {
        throw Errors.InvalidStorage;
    }
    return level2.level13.load();
}

