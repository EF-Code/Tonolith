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

fun selectRamPage(root: RamRoot, index: int): Cell<RamPage> {
    if (index == 0) {
        return root.page0;
    }
    if (index == 1) {
        return root.page1;
    }
    if (index == 2) {
        return root.page2;
    }
    if (index < 0 || index > 3) {
        throw Errors.InvalidStorage;
    }
    return root.page3;
}

fun readRamNibble(core: CoreState, address: int): uint4 {
    val root = core.ram.load();
    val page = selectRamPage(root, address >> 6).load();
    val shift = (address & 63) * 4;
    return ((page.packed >> shift) & 15) as uint4;
}

fun writeRamNibble(ramCell: Cell<RamRoot>, address: int, value: uint4): Cell<RamRoot> {
    val root = ramCell.load();
    val pageIndex = address >> 6;
    val offset = address & 63;
    val oldPage = selectRamPage(root, pageIndex).load();
    val shift = offset * 4;
    val mask = 15 << shift;
    val packed = ((oldPage.packed & ~mask) | (value << shift)) as uint256;
    val newPage = RamPage { packed }.toCell();
    if (pageIndex == 0) {
        return RamRoot {
            page0: newPage,
            page1: root.page1,
            page2: root.page2,
            page3: root.page3,
        }.toCell();
    }
    if (pageIndex == 1) {
        return RamRoot {
            page0: root.page0,
            page1: newPage,
            page2: root.page2,
            page3: root.page3,
        }.toCell();
    }
    if (pageIndex == 2) {
        return RamRoot {
            page0: root.page0,
            page1: root.page1,
            page2: newPage,
            page3: root.page3,
        }.toCell();
    }
    // selectRamPage above proves that pageIndex is in 0..3; page 3 is the
    // remaining valid case after the first three branches.
    return RamRoot {
        page0: root.page0,
        page1: root.page1,
        page2: root.page2,
        page3: newPage,
    }.toCell();
}

fun hasFlag(flags: uint2, flag: uint2): bool {
    return (flags & flag) != 0;
}

fun setZeroFlag(flags: uint2, value: uint4): uint2 {
    if (value == 0) {
        return (flags | FLAG_ZERO) as uint2;
    }
    return (flags & ~FLAG_ZERO) as uint2;
}

fun setCarryFlag(flags: uint2, carry: bool): uint2 {
    if (carry) {
        return (flags | FLAG_CARRY) as uint2;
    }
    return (flags & ~FLAG_CARRY) as uint2;
}

fun readRegister(core: CoreState, index: int): uint4 {
    return ((core.registers >> (index * 4)) & 15) as uint4;
}

fun writeRegister(mutate core: CoreState, index: int, value: uint4) {
    val shift = index * 4;
    val mask = 15 << shift;
    core.registers = ((core.registers & ~mask) | (value << shift)) as uint64;
}

fun addAccumulator(mutate core: CoreState, operand: uint4, includeCarry: bool) {
    val incomingCarry = includeCarry && hasFlag(core.flags, FLAG_CARRY) ? 1 : 0;
    val sum = core.accumulator + operand + incomingCarry;
    core.accumulator = (sum & 15) as uint4;
    core.flags = setCarryFlag(core.flags, sum >= 16);
    core.flags = setZeroFlag(core.flags, core.accumulator);
}

fun subtractAccumulator(mutate core: CoreState, operand: uint4) {
    val before = core.accumulator;
    core.accumulator = ((before - operand) & 15) as uint4;
    core.flags = setCarryFlag(core.flags, before >= operand);
    core.flags = setZeroFlag(core.flags, core.accumulator);
}

fun logicalAccumulator(mutate core: CoreState, value: uint4) {
    core.accumulator = value;
    core.flags = setCarryFlag(core.flags, false);
    core.flags = setZeroFlag(core.flags, core.accumulator);
}

fun executeSys(mutate core: CoreState, subop: int): CpuOutput? {
    if (subop == 0) {
        core.status = STATUS_HALTED;
        return null;
    }
    if (subop == 1) {
        val outputIndex = core.outputCount;
        val value = core.accumulator;
        val commitment = OutputCommitmentPreimage {
            namespace: OUTPUT_NAMESPACE,
            previousCommitment: core.outputCommitment,
            outputIndex,
            instructionCount: core.instructionCount,
            value,
        }.toCell()
            .hash();
        core.outputCount += 1;
        core.outputRegister = value;
        core.outputCommitment = commitment;
        return CpuOutput {
            outputIndex,
            instructionCount: core.instructionCount,
            value,
            outputCommitment: commitment,
        };
    }
    if (subop == 2) {
        core.flags = setCarryFlag(core.flags, false);
        return null;
    }
    if (subop == 3) {
        core.flags = setCarryFlag(core.flags, true);
        return null;
    }
    if (subop == 4) {
        logicalAccumulator(mutate core, ((~core.accumulator) & 15) as uint4);
        return null;
    }
    if (subop == 5) {
        val before = core.accumulator;
        core.flags = setCarryFlag(core.flags, (before & 8) != 0);
        core.accumulator = ((before << 1) & 15) as uint4;
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 6) {
        val before = core.accumulator;
        core.flags = setCarryFlag(core.flags, (before & 1) != 0);
        core.accumulator = (before >> 1) as uint4;
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 7) {
        val before = core.accumulator;
        core.accumulator = ((before + 1) & 15) as uint4;
        core.flags = setCarryFlag(core.flags, before == 15);
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 8) {
        val before = core.accumulator;
        core.accumulator = ((before - 1) & 15) as uint4;
        core.flags = setCarryFlag(core.flags, before != 0);
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    throw Errors.InvalidSysSubop;
}

fun executeInstruction(mutate core: CoreState, word: uint16): CpuOutput? {
    val opcode = word >> 12;
    val operand = word & 0xFFF;
    if (opcode == 0 && operand != 0) {
        throw Errors.NonCanonicalInstruction;
    }
    if (opcode == 1 && operand > 15) {
        throw Errors.NonCanonicalInstruction;
    }
    if (opcode >= 2 && opcode <= 9 && operand > 15) {
        throw Errors.NonCanonicalInstruction;
    }
    if ((opcode == 10 || opcode == 11) && operand > 255) {
        throw Errors.NonCanonicalInstruction;
    }
    if (opcode >= 12 && opcode <= 14 && operand > 1023) {
        throw Errors.NonCanonicalInstruction;
    }
    if (opcode == 15 && (operand & 0xFF0) != 0) {
        throw Errors.NonCanonicalInstruction;
    }
    core.pc = ((core.pc + 1) & 1023) as uint10;
    core.instructionCount += 1;

    if (opcode == 0) {
        return null;
    }
    if (opcode == 1) {
        core.accumulator = operand as uint4;
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (opcode == 2) {
        core.accumulator = readRegister(core, operand);
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (opcode == 3) {
        writeRegister(mutate core, operand, core.accumulator);
        return null;
    }
    if (opcode == 4) {
        addAccumulator(mutate core, readRegister(core, operand), false);
        return null;
    }
    if (opcode == 5) {
        addAccumulator(mutate core, readRegister(core, operand), true);
        return null;
    }
    if (opcode == 6) {
        subtractAccumulator(mutate core, readRegister(core, operand));
        return null;
    }
    if (opcode == 7) {
        logicalAccumulator(mutate core, (core.accumulator & readRegister(core, operand)) as uint4);
        return null;
    }
    if (opcode == 8) {
        logicalAccumulator(mutate core, (core.accumulator | readRegister(core, operand)) as uint4);
        return null;
    }
    if (opcode == 9) {
        logicalAccumulator(mutate core, (core.accumulator ^ readRegister(core, operand)) as uint4);
        return null;
    }
    if (opcode == 10) {
        core.accumulator = readRamNibble(core, operand);
        core.flags = setZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (opcode == 11) {
        core.ram = writeRamNibble(core.ram, operand, core.accumulator);
        return null;
    }
    if (opcode == 12) {
        core.pc = operand as uint10;
        return null;
    }
    if (opcode == 13) {
        if (hasFlag(core.flags, FLAG_ZERO)) {
            core.pc = operand as uint10;
        }
        return null;
    }
    if (opcode == 14) {
        if (hasFlag(core.flags, FLAG_CARRY)) {
            core.pc = operand as uint10;
        }
        return null;
    }
    return executeSys(mutate core, operand);
}

fun makeStorage(rom: Cell<RomRoot>): Storage {
    return Storage {
        magic: TONOLITH_MAGIC,
        schemaVersion: SCHEMA_VERSION,
        isaVersion: ISA_VERSION,
        staticCommitment: staticCommitmentForRom(rom),
        core: initialCore(),
        rom,
    };
}

fun staticCommitmentForRom(rom: Cell<RomRoot>): uint256 {
    // This is the explicit bit-for-bit encoding of StaticCommitmentPreimage.
    // Keeping the preimage builder fixed-width avoids serializer range checks
    // in the Advance hot path while retaining a documented canonical schema.
    return beginCell()
        .storeUint(STATIC_NAMESPACE, 32)
        .storeUint(SCHEMA_VERSION, 16)
        .storeUint(ISA_VERSION, 16)
        .storeUint(rom.hash(), 256)
        .endCell()
        .hash();
}
