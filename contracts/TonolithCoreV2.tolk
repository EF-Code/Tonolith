import "v2/types"

const MIN_ADVANCE_VALUE_V2: coins = ton("0.01")
const STORAGE_RESERVE_V2: coins = ton("0.1")

contract TonolithCoreV2 {
    author: "ef-code"
    version: "2.0.0"
    description: "Tonolith v2 deterministic architectural processor core"
    storage: V2Storage
    incomingMessages: V2AllowedMessage
    incomingExternal: slice
    emittedEvents: V2BatchAdvanced | V2OutputCommitted | V2InputCommitted | V2OutputAcknowledged
    thrownErrors: ErrorsV2
}

fun emitBatchV2(event: V2BatchAdvanced) {
    val message = createExternalLogMessage({
        dest: createAddressNone(),
        body: event,
    });
    message.send(SEND_MODE_REGULAR);
}

fun returnSafeExcessV2(sender: address) {
    val refund = createMessage({
        bounce: BounceMode.NoBounce,
        value: 0,
        dest: sender,
    });
    refund.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
}

fun processAdvanceV2(sender: address, value: coins, msg: V2Advance) {
    assert (msg.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidVersion;
    assert (msg.maxInstructions > 0 && msg.maxInstructions <= MAX_STEPS_PER_ADVANCE_V2) throw ErrorsV2.InvalidBody;
    assert (msg.maxOutputs > 0 && msg.maxOutputs <= MAX_OUTPUT_RECORDS_V2) throw ErrorsV2.InvalidBody;
    assert (value >= MIN_ADVANCE_VALUE_V2) throw ErrorsV2.InsufficientValue;

    var storage = V2Storage.load();
    assert (storage.magic == TONOLITH_MAGIC_V2) throw ErrorsV2.InvalidStorage;
    assert (storage.schemaVersion == SCHEMA_VERSION_V2) throw ErrorsV2.InvalidStorage;
    assert (storage.isaVersion == ISA_VERSION_V2) throw ErrorsV2.InvalidStorage;
    assert (storage.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidStorage;
    assert (storage.protocolVersion == PROTOCOL_VERSION_V2) throw ErrorsV2.InvalidStorage;
    val identity = storage.identity.load();
    assert (msg.runId == identity.runId) throw ErrorsV2.InvalidRun;

    val previousStateHash = storage.core.hash();
    var core = storage.core.load();
    assert (core.domain == DOMAIN_STATE_V2) throw ErrorsV2.InvalidStorage;
    assert (core.staticCommitment == identity.staticCommitment) throw ErrorsV2.InvalidStaticCommitment;
    assert (core.status == STATUS_RUNNING_V2) throw ErrorsV2.InvalidStatus;
    assert (msg.expectedAdvanceCount == core.advanceCount) throw ErrorsV2.StaleAdvance;
    assert (msg.expectedStateHash == previousStateHash) throw ErrorsV2.StateHashMismatch;

    reserveToncoinsOnBalance(
        STORAGE_RESERVE_V2,
        RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
    );

    val startInstructionCount = core.instructionCount;
    core.advanceCount += 1;
    core.acceptedMessageCount += 1;
    storage.core = core.toCell();
    val nextStateHash = storage.core.hash();
    storage.save();

    emitBatchV2(V2BatchAdvanced {
        abiVersion: ABI_VERSION_V2,
        queryId: msg.queryId,
        runId: identity.runId,
        coreId: identity.coreId,
        advanceCount: core.advanceCount,
        epoch: core.epoch,
        startInstructionCount,
        endInstructionCount: core.instructionCount,
        stepsExecuted: 0,
        outputsProduced: 0,
        stopReason: STOP_REQUEST_LIMIT_V2,
        detail: V2BatchDetail {
            previousStateHash,
            nextStateHash,
            batchCommitment: 0,
            finalPc: core.pc,
            finalStatus: core.status,
        }.toCell(),
    });
    returnSafeExcessV2(sender);
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        throw ErrorsV2.InvalidBody;
    }
    if (in.body.remainingBitsCount() < 32) {
        throw ErrorsV2.InvalidBody;
    }
    val opcode = in.body.preloadUint(32);
    if (opcode == MESSAGE_ADVANCE_V2) {
        processAdvanceV2(
            in.senderAddress,
            in.valueCoins,
            V2Advance.fromSlice(in.body, { assertEndAfterReading: true }),
        );
        return;
    }
    if (opcode == MESSAGE_TOP_UP_V2) {
        val msg = V2TopUp.fromSlice(in.body, { assertEndAfterReading: true });
        val storage = V2Storage.load();
        assert (msg.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidVersion;
        assert (msg.runId == storage.identity.load().runId) throw ErrorsV2.InvalidRun;
        return;
    }
    throw ErrorsV2.UnknownMessage;
}

fun onExternalMessage(_in: slice) {
    throw ErrorsV2.ExternalMessageRejected;
}

fun onBouncedMessage(_in: InMessageBounced) {}

get fun getMagicV2(): uint32 {
    val storage = lazy V2Storage.load();
    return storage.magic;
}

get fun getSchemaVersionV2(): uint16 {
    val storage = lazy V2Storage.load();
    return storage.schemaVersion;
}

get fun getIsaVersionV2(): uint16 {
    val storage = lazy V2Storage.load();
    return storage.isaVersion;
}

get fun getAbiVersionV2(): uint16 {
    val storage = lazy V2Storage.load();
    return storage.abiVersion;
}

get fun getProtocolVersionV2(): uint16 {
    val storage = lazy V2Storage.load();
    return storage.protocolVersion;
}

get fun getCoreIdV2(): uint16 {
    val storage = lazy V2Storage.load();
    return storage.identity.load().coreId;
}

get fun getRunIdV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.identity.load().runId;
}

get fun getStaticCommitmentV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.identity.load().staticCommitment;
}

get fun getProgramIdV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.identity.load().programId;
}

get fun getRomRootV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.identity.load().roots.load().romRoot;
}

get fun getRouteRootV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.identity.load().roots.load().routeRoot;
}

get fun getCoreStateHashV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.core.hash();
}

get fun getAdvanceCountV2(): uint64 {
    val storage = lazy V2Storage.load();
    return storage.core.load().advanceCount;
}

get fun getInstructionCountV2(): uint64 {
    val storage = lazy V2Storage.load();
    return storage.core.load().instructionCount;
}

get fun getEpochV2(): uint64 {
    val storage = lazy V2Storage.load();
    return storage.core.load().epoch;
}

get fun getStatusV2(): uint3 {
    val storage = lazy V2Storage.load();
    return storage.core.load().status;
}

get fun getAccumulatorV2(): uint4 {
    val storage = lazy V2Storage.load();
    return storage.core.load().accumulator;
}

get fun getFlagsV2(): uint2 {
    val storage = lazy V2Storage.load();
    return storage.core.load().flags;
}
