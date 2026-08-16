import "v2/commitments"
import "v2/execution"
import "v2/peers"
import "v2/queues"
import "v2/rom"
import "v2/routes"
import "v2/types"

const MIN_ADVANCE_VALUE_V2: coins = ton("0.01")
const MIN_DISPATCH_VALUE_V2: coins = ton("0.02")
const MIN_DELIVERY_VALUE_V2: coins = ton("0.02")
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

fun emitOutputCommittedV2(event: V2OutputCommitted) {
    val message = createExternalLogMessage({
        dest: createAddressNone(),
        body: event,
    });
    message.send(SEND_MODE_REGULAR);
}

fun emitInputCommittedV2(event: V2InputCommitted) {
    val message = createExternalLogMessage({
        dest: createAddressNone(),
        body: event,
    });
    message.send(SEND_MODE_REGULAR);
}

fun emitOutputAcknowledgedV2(event: V2OutputAcknowledged) {
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

fun sendInputAcceptedV2(
    destination: address,
    queryId: uint64,
    runId: uint256,
    outputId: uint256,
    destinationCoreId: uint16,
    destinationEpoch: uint64,
    destinationStateHash: uint256,
) {
    val acknowledgement = createMessage({
        bounce: BounceMode.Only256BitsOfBody,
        value: 0,
        dest: destination,
        body: V2InputAccepted {
            abiVersion: ABI_VERSION_V2,
            queryId,
            runId,
            detail: V2AcknowledgementDetail {
                outputId,
                destinationCoreId,
                destinationEpoch,
                destinationStateHash,
            }.toCell(),
        },
    });
    acknowledgement.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
}

fun v2StopReason(status: uint3, yielded: bool): uint8 {
    if (status == STATUS_HALTED_V2) {
        return STOP_HALTED_V2;
    }
    if (status == STATUS_FAULTED_V2) {
        return STOP_FAULTED_V2;
    }
    if (status == STATUS_WAITING_INPUT_V2) {
        return STOP_INPUT_UNAVAILABLE_V2;
    }
    if (status == STATUS_BACKPRESSURED_V2) {
        return STOP_OUTPUT_BACKPRESSURE_V2;
    }
    if (yielded) {
        return STOP_YIELDED_V2;
    }
    return STOP_REQUEST_LIMIT_V2;
}

fun processDispatchOutputV2(sender: address, value: coins, msg: V2DispatchOutput) {
    assert (msg.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidVersion;
    assert (value >= MIN_DISPATCH_VALUE_V2) throw ErrorsV2.InsufficientValue;
    val storage = V2Storage.load();
    val identity = storage.identity.load();
    assert (msg.runId == identity.runId) throw ErrorsV2.InvalidRun;
    val previousStateHash = storage.core.hash();
    assert (msg.expectedStateHash == previousStateHash) throw ErrorsV2.StateHashMismatch;
    val core = storage.core.load();
    val queues = core.queues.load();
    val cursor = v2FindRecordById(queues.outboxRoot, msg.outputId);
    assert (cursor.found != 0) throw ErrorsV2.NotFound;
    val output = v2OutputAt(queues.outboxRoot, cursor.index);
    assert (output.domain == DOMAIN_OUTPUT_V2) throw ErrorsV2.InvalidStorage;
    assert (output.outputId == msg.outputId) throw ErrorsV2.ConflictingReplay;
    val peer = v2FindPeer(storage.network.load().peers, output.destinationCoreId);
    assert (peer != null) throw ErrorsV2.UnauthorizedPeer;

    reserveToncoinsOnBalance(
        STORAGE_RESERVE_V2,
        RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
    );
    val delivery = createMessage({
        bounce: BounceMode.Only256BitsOfBody,
        value: MIN_DELIVERY_VALUE_V2,
        dest: peer!.peerAddress,
        body: V2DeliverInput {
            abiVersion: ABI_VERSION_V2,
            queryId: msg.queryId,
            runId: identity.runId,
            outputId: output.outputId,
            sourceCoreId: output.sourceCoreId,
            destinationCoreId: output.destinationCoreId,
            sourceEpoch: output.sourceEpoch,
            destinationEpoch: output.destinationEpoch,
            sourcePort: output.sourcePort,
            destinationPort: output.destinationPort,
            sequence: output.sequence,
            value: output.value,
            sourceInstructionCount: output.sourceInstructionCount,
            sourceState: V2Hash { value: output.sourceStateHash }.toCell(),
        },
    });
    delivery.send(SEND_MODE_REGULAR);
    returnSafeExcessV2(sender);
}

fun processDeliverInputV2(sender: address, value: coins, msg: V2DeliverInput) {
    assert (msg.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidVersion;
    assert (value >= MIN_DELIVERY_VALUE_V2) throw ErrorsV2.InsufficientValue;
    var storage = V2Storage.load();
    val identity = storage.identity.load();
    assert (msg.runId == identity.runId) throw ErrorsV2.InvalidRun;
    assert (msg.destinationCoreId == identity.coreId) throw ErrorsV2.UnauthorizedPeer;
    val network = storage.network.load();
    val sourcePeer = v2FindPeer(network.peers, msg.sourceCoreId);
    assert (sourcePeer != null) throw ErrorsV2.UnauthorizedPeer;
    assert (sender == sourcePeer!.peerAddress) throw ErrorsV2.UnauthorizedPeer;
    val route = v2FindRoute(network.routes, msg.sourceCoreId, msg.sourcePort);
    assert (route != null) throw ErrorsV2.InvalidRoute;
    assert (route!.destinationCoreId == msg.destinationCoreId) throw ErrorsV2.InvalidRoute;
    assert (route!.destinationPort == msg.destinationPort) throw ErrorsV2.InvalidRoute;
    assert (msg.destinationEpoch == msg.sourceEpoch + route!.delay) throw ErrorsV2.InvalidEpoch;
    assert (msg.sequence < route!.maxRecordsPerEpoch) throw ErrorsV2.InvalidSequence;
    assert (
        msg.destinationEpoch >= storage.core.load().epoch &&
        msg.destinationEpoch <= storage.core.load().epoch + 1
    ) throw ErrorsV2.InvalidEpoch;
    val expectedOutputId = v2OutputId(
        identity.runId,
        msg.sourceCoreId,
        msg.destinationCoreId,
        msg.sourceEpoch,
        msg.destinationEpoch,
        msg.sourcePort,
        msg.destinationPort,
        msg.sequence,
        msg.value,
        msg.sourceInstructionCount,
    );
    assert (expectedOutputId == msg.outputId) throw ErrorsV2.InvalidRoute;
    val sourceStateHash = msg.sourceState.load().value;
    var core = storage.core.load();
    val queues = core.queues.load();
    val existingCursor = v2FindRecordById(queues.inboxRoot, msg.outputId);
    if (existingCursor.found != 0) {
        val existing = v2InputAt(queues.inboxRoot, existingCursor.index);
        assert (existing.domain == DOMAIN_INPUT_V2) throw ErrorsV2.InvalidStorage;
        assert (
            existing.sourceCoreId == msg.sourceCoreId &&
            existing.destinationCoreId == msg.destinationCoreId &&
            existing.sourceEpoch == msg.sourceEpoch &&
            existing.destinationEpoch == msg.destinationEpoch &&
            existing.sourcePort == msg.sourcePort &&
            existing.destinationPort == msg.destinationPort &&
            existing.sequence == msg.sequence &&
            existing.value == msg.value &&
            existing.sourceInstructionCount == msg.sourceInstructionCount &&
            existing.sourceStateHash == sourceStateHash
        ) throw ErrorsV2.ConflictingReplay;
        reserveToncoinsOnBalance(
            STORAGE_RESERVE_V2,
            RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
        );
        sendInputAcceptedV2(
            sender,
            msg.queryId,
            identity.runId,
            msg.outputId,
            identity.coreId,
            msg.destinationEpoch,
            storage.core.hash(),
        );
        return;
    }
    val slotCursor = v2FindInputSlot(
        queues.inboxRoot,
        msg.destinationEpoch,
        msg.destinationPort,
        msg.sequence,
    );
    assert (slotCursor.found == 0) throw ErrorsV2.ConflictingReplay;
    assert (v2QueueCount(queues.inboxRoot) < MAX_INPUT_RECORDS_V2) throw ErrorsV2.QueueFull;
    val input = V2InputRecord {
        domain: DOMAIN_INPUT_V2,
        outputId: msg.outputId,
        sourceCoreId: msg.sourceCoreId,
        destinationCoreId: msg.destinationCoreId,
        sourceEpoch: msg.sourceEpoch,
        destinationEpoch: msg.destinationEpoch,
        sourcePort: msg.sourcePort,
        destinationPort: msg.destinationPort,
        sequence: msg.sequence,
        value: msg.value,
        sourceInstructionCount: msg.sourceInstructionCount,
        sourceStateHash,
        consumed: 0,
    }.toCell();
    var updatedQueues = queues;
    updatedQueues.inboxRoot = v2InsertInputRecord(queues.inboxRoot, input);
    core.queues = updatedQueues.toCell();
    core.inputCount += 1;
    core.acceptedMessageCount += 1;
    var commitments = core.commitments.load();
    commitments.inputCommitment = nextV2InputCommitment(
        commitments.inputCommitment,
        msg.outputId,
        msg.destinationEpoch,
        msg.sequence,
        msg.value,
        0,
    );
    core.commitments = commitments.toCell();
    if (core.status == STATUS_WAITING_INPUT_V2 && msg.destinationEpoch == core.epoch) {
        core.status = STATUS_RUNNING_V2;
    }
    storage.core = core.toCell();
    val destinationStateHash = storage.core.hash();
    storage.save();
    emitInputCommittedV2(V2InputCommitted {
        abiVersion: ABI_VERSION_V2,
        queryId: msg.queryId,
        runId: identity.runId,
        outputId: msg.outputId,
        sourceCoreId: msg.sourceCoreId,
        destinationCoreId: msg.destinationCoreId,
        epoch: msg.destinationEpoch,
        destinationPort: msg.destinationPort,
        sequence: msg.sequence,
        inputCommitment: commitments.inputCommitment,
    });
    reserveToncoinsOnBalance(
        STORAGE_RESERVE_V2,
        RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
    );
    sendInputAcceptedV2(
        sender,
        msg.queryId,
        identity.runId,
        msg.outputId,
        identity.coreId,
        msg.destinationEpoch,
        destinationStateHash,
    );
}

fun processInputAcceptedV2(sender: address, msg: V2InputAccepted) {
    assert (msg.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidVersion;
    val detail = msg.detail.load();
    var storage = V2Storage.load();
    val identity = storage.identity.load();
    assert (msg.runId == identity.runId) throw ErrorsV2.InvalidRun;
    val network = storage.network.load();
    val destinationPeer = v2FindPeer(network.peers, detail.destinationCoreId);
    assert (destinationPeer != null) throw ErrorsV2.UnauthorizedPeer;
    assert (sender == destinationPeer!.peerAddress) throw ErrorsV2.UnauthorizedPeer;
    var core = storage.core.load();
    val queues = core.queues.load();
    val cursor = v2FindRecordById(queues.outboxRoot, detail.outputId);
    if (cursor.found == 0) {
        return;
    }
    val output = v2OutputAt(queues.outboxRoot, cursor.index);
    assert (output.domain == DOMAIN_OUTPUT_V2) throw ErrorsV2.InvalidStorage;
    assert (output.destinationCoreId == detail.destinationCoreId) throw ErrorsV2.UnauthorizedPeer;
    assert (output.destinationEpoch == detail.destinationEpoch) throw ErrorsV2.InvalidEpoch;
    var updatedQueues = queues;
    updatedQueues.outboxRoot = v2RemoveRecordAt(queues.outboxRoot, cursor.index);
    core.queues = updatedQueues.toCell();
    core.acceptedMessageCount += 1;
    var commitments = core.commitments.load();
    commitments.outputCommitment = nextV2AcknowledgementCommitment(
        commitments.outputCommitment,
        detail.outputId,
    );
    core.commitments = commitments.toCell();
    if (
        core.status == STATUS_BACKPRESSURED_V2 && v2QueueCount(updatedQueues.outboxRoot) <
        MAX_OUTPUT_RECORDS_V2
    ) {
        core.status = STATUS_RUNNING_V2;
    }
    storage.core = core.toCell();
    storage.save();
    reserveToncoinsOnBalance(
        STORAGE_RESERVE_V2,
        RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
    );
    emitOutputAcknowledgedV2(V2OutputAcknowledged {
        abiVersion: ABI_VERSION_V2,
        queryId: msg.queryId,
        runId: identity.runId,
        outputId: detail.outputId,
        destinationCoreId: detail.destinationCoreId,
        destinationEpoch: detail.destinationEpoch,
        outputCommitment: commitments.outputCommitment,
    });
}

fun processAdvanceV2(sender: address, value: coins, msg: V2Advance) {
    assert (msg.abiVersion == ABI_VERSION_V2) throw ErrorsV2.InvalidVersion;
    assert (
        msg.maxInstructions > 0 && msg.maxInstructions <= MAX_STEPS_PER_ADVANCE_V2
    ) throw ErrorsV2.InvalidBody;
    assert (
        msg.maxOutputs > 0 && msg.maxOutputs <= MAX_OUTPUT_RECORDS_V2
    ) throw ErrorsV2.InvalidBody;
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
    assert (
        core.staticCommitment == identity.staticCommitment
    ) throw ErrorsV2.InvalidStaticCommitment;
    assert (
        core.status != STATUS_HALTED_V2 && core.status != STATUS_FAULTED_V2
    ) throw ErrorsV2.InvalidStatus;
    assert (msg.expectedAdvanceCount == core.advanceCount) throw ErrorsV2.StaleAdvance;
    assert (msg.expectedStateHash == previousStateHash) throw ErrorsV2.StateHashMismatch;

    reserveToncoinsOnBalance(
        STORAGE_RESERVE_V2,
        RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
    );

    val startInstructionCount = core.instructionCount;
    val startOutputCount = core.outputCount;
    val startOutboxCount = v2QueueCount(core.queues.load().outboxRoot);
    val startEpoch = core.epoch;
    if (core.status == STATUS_WAITING_INPUT_V2 || core.status == STATUS_BACKPRESSURED_V2) {
        core.status = STATUS_RUNNING_V2;
    }
    var stepsExecuted: uint16 = 0;
    var outputsProduced: uint8 = 0;
    var trace = previousStateHash;
    var keepRunning = true;
    while (keepRunning && stepsExecuted < msg.maxInstructions && core.status == STATUS_RUNNING_V2) {
        val word = v2RomWord(storage.rom, core.pc);
        val beforeInstructionCount = core.instructionCount;
        val instructionStateHash = core.toCell().hash();
        val _legacyOutput = v2ExecuteInstruction(
            mutate core,
            word,
            identity.runId,
            identity.coreId,
            storage.network.load().routes,
            instructionStateHash,
        );
        if (core.instructionCount == beforeInstructionCount) {
            keepRunning = false;
        }
        if (core.instructionCount != beforeInstructionCount) {
            trace = nextV2TraceCommitment(trace, word, core.toCell().hash());
            stepsExecuted = (core.instructionCount - startInstructionCount) as uint16;
            outputsProduced = (core.outputCount - startOutputCount) as uint8;
            if (core.epoch != startEpoch || outputsProduced >= msg.maxOutputs) {
                keepRunning = false;
            }
        }
    }
    val yielded = core.epoch != startEpoch;
    val stopReason = v2StopReason(core.status, yielded);
    core.advanceCount += 1;
    core.acceptedMessageCount += 1;
    storage.core = core.toCell();
    val nextStateHash = storage.core.hash();
    storage.save();

    val nextQueues = core.queues.load();
    if (v2QueueCount(nextQueues.outboxRoot) > startOutboxCount) {
        val output = v2OutputAt(nextQueues.outboxRoot, startOutboxCount);
        emitOutputCommittedV2(V2OutputCommitted {
            abiVersion: ABI_VERSION_V2,
            queryId: msg.queryId,
            runId: identity.runId,
            outputId: output.outputId,
            sourceCoreId: output.sourceCoreId,
            destinationCoreId: output.destinationCoreId,
            epoch: output.sourceEpoch,
            sourcePort: output.sourcePort,
            destinationPort: output.destinationPort,
            sequence: output.sequence,
            value: output.value,
            outputCommitment: core.commitments.load().outputCommitment,
        });
    }

    emitBatchV2(V2BatchAdvanced {
        abiVersion: ABI_VERSION_V2,
        queryId: msg.queryId,
        runId: identity.runId,
        coreId: identity.coreId,
        advanceCount: core.advanceCount,
        epoch: core.epoch,
        startInstructionCount,
        endInstructionCount: core.instructionCount,
        stepsExecuted,
        outputsProduced,
        stopReason,
        detail: V2BatchDetail {
            previousStateHash,
            nextStateHash,
            batchCommitment: nextV2BatchCommitment(
                previousStateHash,
                nextStateHash,
                startInstructionCount,
                core.instructionCount,
                stepsExecuted,
                outputsProduced,
                stopReason,
                trace,
            ),
            finalPc: core.pc,
            finalStatus: core.status,
        }.toCell(),
    });
    returnSafeExcessV2(sender);
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
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
    if (opcode == MESSAGE_DISPATCH_OUTPUT_V2) {
        processDispatchOutputV2(
            in.senderAddress,
            in.valueCoins,
            V2DispatchOutput.fromSlice(in.body, { assertEndAfterReading: true }),
        );
        return;
    }
    if (opcode == MESSAGE_DELIVER_INPUT_V2) {
        processDeliverInputV2(
            in.senderAddress,
            in.valueCoins,
            V2DeliverInput.fromSlice(in.body, { assertEndAfterReading: true }),
        );
        return;
    }
    if (opcode == MESSAGE_INPUT_ACCEPTED_V2) {
        processInputAcceptedV2(
            in.senderAddress,
            V2InputAccepted.fromSlice(in.body, { assertEndAfterReading: true }),
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

/// A bounced dispatch or acknowledgement is deliberately non-destructive.
///
/// The outbox is the retry journal: an output is removed only after the
/// destination has accepted it and returned `MESSAGE_INPUT_ACCEPTED_V2`.
/// Therefore a bounce must not advance a sequence, clear an output, or write
/// a speculative retry record.  A keeper can safely dispatch the same output
/// again with a new query id.  We still parse the bounded bounce prefix so a
/// malformed bounce is ignored without touching persistent state.
fun onBouncedMessage(in: InMessageBounced) {
    if (in.bouncedBody.remainingBitsCount() < 32) {
        return;
    }
    var body = in.bouncedBody;
    body.skipBouncedPrefix();
    if (body.remainingBitsCount() < 32) {
        return;
    }
    val opcode = body.preloadUint(32);
    if (opcode == MESSAGE_DELIVER_INPUT_V2 || opcode == MESSAGE_INPUT_ACCEPTED_V2) {
        return;
    }
}

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

get fun getPcV2(): uint10 {
    val storage = lazy V2Storage.load();
    return storage.core.load().pc;
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

get fun getAcceptedMessageCountV2(): uint64 {
    val storage = lazy V2Storage.load();
    return storage.core.load().acceptedMessageCount;
}

get fun getOutputCountV2(): uint64 {
    val storage = lazy V2Storage.load();
    return storage.core.load().outputCount;
}

get fun getInputCountV2(): uint64 {
    val storage = lazy V2Storage.load();
    return storage.core.load().inputCount;
}

get fun getInboxCountV2(): uint8 {
    val storage = lazy V2Storage.load();
    return v2QueueCount(storage.core.load().queues.load().inboxRoot) as uint8;
}

get fun getOutboxCountV2(): uint8 {
    val storage = lazy V2Storage.load();
    return v2QueueCount(storage.core.load().queues.load().outboxRoot) as uint8;
}

get fun getOutputCommitmentV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.core.load().commitments.load().outputCommitment;
}

get fun getInputCommitmentV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.core.load().commitments.load().inputCommitment;
}

get fun getEpochHistoryCommitmentV2(): uint256 {
    val storage = lazy V2Storage.load();
    return storage.core.load().commitments.load().epochHistoryCommitment;
}
