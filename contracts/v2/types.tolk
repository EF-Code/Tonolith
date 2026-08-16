enum ErrorsV2 {
    UnknownMessage = 100
    InvalidAbi = 101
    InvalidVersion = 102
    InvalidBody = 103
    InvalidValue = 104
    StaleAdvance = 120
    StateHashMismatch = 121
    InvalidRun = 122
    InvalidStaticCommitment = 123
    InvalidStatus = 124
    InvalidInstruction = 140
    InvalidPc = 141
    ArchitecturalInvariant = 142
    UnauthorizedPeer = 160
    InvalidRoute = 161
    InvalidEpoch = 162
    InvalidSequence = 163
    ConflictingReplay = 164
    QueueFull = 165
    NotFound = 166
    InsufficientReserve = 180
    InsufficientValue = 181
    InvalidStorage = 190
    ExternalMessageRejected = 191
}

const TONOLITH_MAGIC_V2: uint32 = 0x544E4C32
const SCHEMA_VERSION_V2: uint16 = 2
const ISA_VERSION_V2: uint16 = 2
const ABI_VERSION_V2: uint16 = 2
const PROTOCOL_VERSION_V2: uint16 = 2
const DOMAIN_STATE_V2: uint32 = 0x544C4332
const DOMAIN_EPOCH_V2: uint32 = 0x544C4532
const DOMAIN_OUTPUT_V2: uint32 = 0x544C4F32
const DOMAIN_INPUT_V2: uint32 = 0x544C4932
const DOMAIN_ACK_V2: uint32 = 0x544C4132
const DOMAIN_BATCH_V2: uint32 = 0x544C4232
const MESSAGE_ADVANCE_V2: uint32 = 0x544E4C21
const MESSAGE_DISPATCH_OUTPUT_V2: uint32 = 0x544E4C22
const MESSAGE_DELIVER_INPUT_V2: uint32 = 0x544E4C23
const MESSAGE_INPUT_ACCEPTED_V2: uint32 = 0x544E4C24
const MESSAGE_TOP_UP_V2: uint32 = 0x544E4C25
const EVENT_BATCH_ADVANCED_V2: uint32 = 0x544E4CA1
const EVENT_OUTPUT_COMMITTED_V2: uint32 = 0x544E4CA2
const EVENT_INPUT_COMMITTED_V2: uint32 = 0x544E4CA3
const EVENT_OUTPUT_ACKNOWLEDGED_V2: uint32 = 0x544E4CA4

const FLAG_ZERO_V2: uint2 = 1
const FLAG_CARRY_V2: uint2 = 2
const STATUS_RUNNING_V2: uint3 = 0
const STATUS_WAITING_INPUT_V2: uint3 = 1
const STATUS_BACKPRESSURED_V2: uint3 = 2
const STATUS_HALTED_V2: uint3 = 3
const STATUS_FAULTED_V2: uint3 = 4
const STOP_REQUEST_LIMIT_V2: uint8 = 0
const STOP_HALTED_V2: uint8 = 1
const STOP_FAULTED_V2: uint8 = 2
const STOP_INPUT_UNAVAILABLE_V2: uint8 = 3
const STOP_OUTPUT_BACKPRESSURE_V2: uint8 = 4
const STOP_YIELDED_V2: uint8 = 5
const STOP_OUTPUT_EVENT_LIMIT_V2: uint8 = 6
const MAX_STEPS_PER_ADVANCE_V2: uint16 = 1
const MAX_INPUT_RECORDS_V2: uint8 = 16
const MAX_OUTPUT_RECORDS_V2: uint8 = 16

struct V2Hash {
    value: uint256
}

struct V2CoreCommitments {
    outputCommitment: uint256
    inputCommitment: uint256
    epochHistoryCommitment: uint256
}

struct V2Registers {
    packed: uint64
}

struct V2RamPage {
    packed: uint256
}

struct V2RamRoot {
    page0: Cell<V2RamPage>
    page1: Cell<V2RamPage>
    page2: Cell<V2RamPage>
    page3: Cell<V2RamPage>
}

struct V2QueueRoots {
    inboxRoot: cell
    outboxRoot: cell
}

struct V2CoreState {
    domain: uint32
    staticCommitment: uint256
    status: uint3
    faultCode: uint8
    pc: uint10
    accumulator: uint4
    flags: uint2
    epoch: uint64
    instructionCount: uint64
    advanceCount: uint64
    acceptedMessageCount: uint64
    outputCount: uint64
    inputCount: uint64
    nextOutputSequence: uint128
    commitments: Cell<V2CoreCommitments>
    memory: cell
    queues: Cell<V2QueueRoots>
}

struct V2StaticRoots {
    romRoot: uint256
    routeRoot: uint256
    limitsHash: uint256
}

struct V2StaticData {
    coreId: uint16
    runId: uint256
    staticCommitment: uint256
    programId: uint256
    roots: Cell<V2StaticRoots>
}

struct V2Storage {
    magic: uint32
    schemaVersion: uint16
    isaVersion: uint16
    abiVersion: uint16
    protocolVersion: uint16
    identity: Cell<V2StaticData>
    core: Cell<V2CoreState>
    rom: cell
    routes: cell
}

fun V2Storage.load(): V2Storage {
    return V2Storage.fromCell(contract.getData());
}

fun V2Storage.save(self) {
    contract.setData(self.toCell());
}

struct (0x544E4C21) V2Advance {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    expectedAdvanceCount: uint64
    expectedStateHash: uint256
    maxInstructions: uint16
    maxOutputs: uint8
}

struct (0x544E4C22) V2DispatchOutput {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    expectedStateHash: uint256
    outputId: uint256
}

struct (0x544E4C23) V2DeliverInput {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    outputId: uint256
    sourceCoreId: uint16
    destinationCoreId: uint16
    sourceEpoch: uint64
    destinationEpoch: uint64
    sourcePort: uint4
    destinationPort: uint4
    sequence: uint8
    value: uint4
    sourceInstructionCount: uint64
    sourceState: Cell<V2Hash>
}

struct (0x544E4C24) V2InputAccepted {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    outputId: uint256
    destinationCoreId: uint16
    destinationEpoch: uint64
    destinationStateHash: uint256
}

struct (0x544E4C25) V2TopUp {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
}

struct (0x544E4CA1) V2BatchAdvanced {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    coreId: uint16
    advanceCount: uint64
    epoch: uint64
    startInstructionCount: uint64
    endInstructionCount: uint64
    stepsExecuted: uint16
    outputsProduced: uint8
    stopReason: uint8
    detail: Cell<V2BatchDetail>
}

struct V2BatchDetail {
    previousStateHash: uint256
    nextStateHash: uint256
    batchCommitment: uint256
    finalPc: uint10
    finalStatus: uint3
}

struct (0x544E4CA2) V2OutputCommitted {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    outputId: uint256
    sourceCoreId: uint16
    destinationCoreId: uint16
    epoch: uint64
    sourcePort: uint4
    destinationPort: uint4
    sequence: uint8
    value: uint4
    outputCommitment: uint256
}

struct (0x544E4CA3) V2InputCommitted {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    outputId: uint256
    sourceCoreId: uint16
    destinationCoreId: uint16
    epoch: uint64
    destinationPort: uint4
    sequence: uint8
    inputCommitment: uint256
}

struct (0x544E4CA4) V2OutputAcknowledged {
    abiVersion: uint16
    queryId: uint64
    runId: uint256
    outputId: uint256
    destinationCoreId: uint16
    destinationEpoch: uint64
    outputCommitment: uint256
}

type V2AllowedMessage =
    | V2Advance
    | V2DispatchOutput
    | V2DeliverInput
    | V2InputAccepted
    | V2TopUp
