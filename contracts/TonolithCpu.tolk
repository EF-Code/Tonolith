import "types"

const MIN_ADVANCE_VALUE: coins = ton("0.01")
const STORAGE_RESERVE: coins = ton("0.1")

contract TonolithCpu {
    author: "ef-code"
    version: "0.1.0"
    description: "Tonolith v1 deterministic 4-bit processor"
    storage: Storage
    incomingMessages: AllowedMessage
    incomingExternal: slice
    emittedEvents: CpuAdvanced | CpuOutput
    thrownErrors: Errors
}

fun emitAdvanced(event: CpuAdvanced) {
    val message = createExternalLogMessage({
        dest: createAddressNone(),
        body: event,
    });
    message.send(SEND_MODE_REGULAR);
}

fun emitOutput(event: CpuOutput?) {
    if (event != null) {
        val message = createExternalLogMessage({
            dest: createAddressNone(),
            body: event,
        });
        message.send(SEND_MODE_REGULAR);
    }
}

fun returnSafeExcess(sender: address) {
    val refund = createMessage({
        bounce: BounceMode.NoBounce,
        value: 0,
        dest: sender,
    });
    refund.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
}

fun processAdvance(sender: address, value: coins, msg: Advance) {
    assert (
        msg.maxInstructions > 0 && msg.maxInstructions <= MAX_STEPS_PER_ADVANCE
    ) throw Errors.InvalidStepCount;
    assert (value >= MIN_ADVANCE_VALUE) throw Errors.InsufficientValue;

    var storage = Storage.load();
    assert (storage.magic == TONOLITH_MAGIC) throw Errors.InvalidStorage;
    assert (storage.schemaVersion == SCHEMA_VERSION) throw Errors.InvalidStorage;
    assert (storage.isaVersion == ISA_VERSION) throw Errors.InvalidStorage;

    val previousStateHash = storage.core.hash();
    var core = (storage.core as Cell<CoreState>).load();
    assert (core.status == STATUS_RUNNING) throw Errors.Halted;
    assert (msg.expectedAdvanceCount == core.advanceCount) throw Errors.StaleAdvance;
    assert (msg.expectedStateHash == previousStateHash) throw Errors.StateHashMismatch;
    assert (
        storage.staticCommitment == staticCommitmentForRom(storage.rom as Cell<RomRoot>)
    ) throw Errors.InvalidStorage;

    reserveToncoinsOnBalance(
        STORAGE_RESERVE,
        RESERVE_MODE_AT_MOST | RESERVE_MODE_BOUNCE_ON_ACTION_FAIL,
    );

    val startInstruction = core.instructionCount;
    val word = romWord(storage.rom as Cell<RomRoot>, core.pc);
    val output = executeInstruction(mutate core, word);
    core.advanceCount += 1;
    storage.core = core.toCell();
    val nextStateHash = storage.core.hash();
    storage.save();

    emitOutput(output);
    emitAdvanced(CpuAdvanced {
        queryId: msg.queryId,
        advanceCount: core.advanceCount,
        startInstruction,
        endInstruction: core.instructionCount,
        previousStateHash,
        nextStateHash,
        finalPc: core.pc,
        status: core.status,
    });
    returnSafeExcess(sender);
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }
    if (in.body.remainingBitsCount() < 32) {
        throw Errors.UnknownMessage;
    }

    val opcode = in.body.preloadUint(32);
    if (opcode == 0x544E4C01) {
        processAdvance(
            in.senderAddress,
            in.valueCoins,
            Advance.fromSlice(in.body, { assertEndAfterReading: true }),
        );
        return;
    }
    if (opcode == 0x544E4C02) {
        val _msg = TopUp.fromSlice(in.body, { assertEndAfterReading: true });
        return;
    }
    throw Errors.UnknownMessage;
}

fun onExternalMessage(_in: slice) {
    throw Errors.ExternalMessageRejected;
}

fun onBouncedMessage(_in: InMessageBounced) {}

get fun getMagic(): uint32 {
    val storage = lazy Storage.load();
    return storage.magic;
}

get fun getSchemaVersion(): uint16 {
    val storage = lazy Storage.load();
    return storage.schemaVersion;
}

get fun getIsaVersion(): uint16 {
    val storage = lazy Storage.load();
    return storage.isaVersion;
}

get fun getStaticCommitment(): uint256 {
    val storage = lazy Storage.load();
    return storage.staticCommitment;
}

get fun getCoreStateHash(): uint256 {
    val storage = lazy Storage.load();
    return storage.core.hash();
}

get fun getRomRootHash(): uint256 {
    val storage = lazy Storage.load();
    return storage.rom.hash();
}

get fun getRomWord(address: uint10): uint16 {
    val storage = lazy Storage.load();
    return romWord(storage.rom as Cell<RomRoot>, address);
}

