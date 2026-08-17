import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@acton/tlb/either"
import "@wrappers/TonolithCoreV2.gen"
import "@contracts/v2/commitments"
import "@contracts/v2/execution"
import "@contracts/v2/memory"
import "@contracts/v2/peers"
import "@contracts/v2/queues"
import "@contracts/v2/rom"
import "@contracts/v2/types"

fun batchStorage(rom: Cell<V2RomRoot>, routes: cell): V2Storage {
    return batchStorageWithPeers(rom, routes, emptyV2RecordRoot());
}

fun batchStorageWithPeers(rom: Cell<V2RomRoot>, routes: cell, peers: cell): V2Storage {
    val staticRoots = V2StaticRoots {
        romRoot: rom.hash(),
        routeRoot: routes.hash(),
        limitsHash: 0,
        peers: V2PeerRoots { peerRoot: peers.hash() }.toCell(),
    }.toCell();
    val identity = V2StaticData {
        coreId: 0,
        runId: 0,
        staticCommitment: 0,
        programId: 0,
        roots: staticRoots,
    }.toCell();
    val commitments = V2CoreCommitments {
        outputCommitment: 0,
        inputCommitment: 0,
        epochHistoryCommitment: 0,
    }.toCell();
    val core = V2CoreState {
        domain: DOMAIN_STATE_V2,
        staticCommitment: 0,
        status: STATUS_RUNNING_V2,
        faultCode: 0,
        pc: 0,
        accumulator: 0,
        flags: 0,
        epoch: 0,
        instructionCount: 0,
        advanceCount: 0,
        acceptedMessageCount: 0,
        outputCount: 0,
        inputCount: 0,
        nextOutputSequence: 0,
        commitments,
        memory: zeroV2Memory(),
        queues: emptyV2Queues(),
    }.toCell();
    return V2Storage {
        magic: TONOLITH_MAGIC_V2,
        schemaVersion: SCHEMA_VERSION_V2,
        isaVersion: ISA_VERSION_V2,
        abiVersion: ABI_VERSION_V2,
        protocolVersion: PROTOCOL_VERSION_V2,
        identity,
        core,
        rom,
        network: V2NetworkData { routes, peers }.toCell(),
    };
}

fun batchRom(word: uint16): Cell<V2RomRoot> {
    return v2RomWithFirstLeaf(
        V2RomLeaf {
            firstHalf: (word as uint256) << 240,
            secondHalf: 0,
        }.toCell(),
    );
}

fun batchRomWithLevel1Word(word: uint16): Cell<V2RomRoot> {
    val zeroLeaf = V2RomLeaf {
        firstHalf: 0,
        secondHalf: 0,
    }.toCell();
    val selectedLeaf = V2RomLeaf {
        firstHalf: (word as uint256) << 240,
        secondHalf: 0,
    }.toCell();
    val selectedLevel1 = V2RomLevel1 {
        leaf0: selectedLeaf,
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val zeroLevel1 = V2RomLevel1 {
        leaf0: zeroLeaf,
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val selectedLevel2 = V2RomLevel2 {
        level10: zeroLevel1,
        level11: zeroLevel1,
        level12: zeroLevel1,
        level13: selectedLevel1,
    }.toCell();
    val zeroLevel2 = zeroV2RomLevel2();
    return V2RomRoot {
        level20: selectedLevel2,
        level21: zeroLevel2,
        level22: zeroLevel2,
        level23: zeroLevel2,
    }.toCell();
}

fun batchRomBoundaryLeaf(firstWord: uint16, secondWord: uint16 = 0): Cell<V2RomLeaf> {
    return V2RomLeaf {
        firstHalf: (firstWord as uint256) << 240,
        secondHalf: (secondWord as uint256) << 240,
    }.toCell();
}

fun batchRomSelectorBoundaries(): Cell<V2RomRoot> {
    val zeroLeaf = batchRomBoundaryLeaf(0);
    val level10 = V2RomLevel1 {
        leaf0: V2RomLeaf {
            firstHalf: ((0x1001 as uint256) << 240) | ((0x1009 as uint256) << 224),
            secondHalf: (0x1005 as uint256) << 240,
        }.toCell(),
        leaf1: batchRomBoundaryLeaf(0x1002),
        leaf2: batchRomBoundaryLeaf(0x1003),
        leaf3: batchRomBoundaryLeaf(0x1004),
    }.toCell();
    val level11 = V2RomLevel1 {
        leaf0: batchRomBoundaryLeaf(0x1006),
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val level12 = V2RomLevel1 {
        leaf0: batchRomBoundaryLeaf(0x1007),
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val level13 = V2RomLevel1 {
        leaf0: batchRomBoundaryLeaf(0x1008),
        leaf1: zeroLeaf,
        leaf2: zeroLeaf,
        leaf3: zeroLeaf,
    }.toCell();
    val level20 = V2RomLevel2 { level10, level11, level12, level13 }.toCell();
    val zeroLevel2 = zeroV2RomLevel2();
    return V2RomRoot {
        level20,
        level21: zeroLevel2,
        level22: zeroLevel2,
        level23: zeroLevel2,
    }.toCell();
}

fun batchRunAtPc(rom: Cell<V2RomRoot>, pc: uint10, deployer: address): TonolithCoreV2 {
    var storage = batchStorage(rom, emptyV2RecordRoot());
    var initialCore = storage.core.load();
    initialCore.pc = pc;
    storage.core = initialCore.toCell();
    return batchRunStorage(storage, deployer);
}

fun batchRunStorage(storage: V2Storage, deployer: address): TonolithCoreV2 {
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    batchAdvance(core, deployer);
    return core;
}

fun batchIsaRom(): Cell<V2RomRoot> {
    val firstHalf = ((0x0000 as uint256) << 240) | ((0x1001 as uint256) << 224) |
    ((0x2000 as uint256) << 208) |
    ((0x3000 as uint256) << 192) |
    ((0x4000 as uint256) << 176) |
    ((0x5000 as uint256) << 160) |
    ((0x6000 as uint256) << 144) |
    ((0x7000 as uint256) << 128) |
    ((0x8000 as uint256) << 112) |
    ((0x9000 as uint256) << 96) |
    ((0xA000 as uint256) << 80) |
    ((0xB000 as uint256) << 64) |
    ((0x1001 as uint256) << 48) |
    ((0xD00F as uint256) << 32) |
    ((0xE00F as uint256) << 16);
    return v2RomWithFirstLeaf(
        V2RomLeaf {
            firstHalf,
            secondHalf: 0,
        }.toCell(),
    );
}

fun batchAdvance(core: TonolithCoreV2, from: address, maxOutputs: uint8 = MAX_OUTPUT_RECORDS_V2) {
    val result = batchAdvanceWithQuery(core, from, 0, maxOutputs);
    expect(result).toHaveSuccessfulTx<V2Advance>();
}

fun batchAdvanceWithQuery(
    core: TonolithCoreV2,
    from: address,
    queryId: uint64,
    maxOutputs: uint8 = MAX_OUTPUT_RECORDS_V2,
): SendResultList {
    return core.sendV2Advance(
        from,
        ABI_VERSION_V2,
        queryId,
        core.getRunIdV2(),
        core.getAdvanceCountV2(),
        core.getCoreStateHashV2(),
        MAX_STEPS_PER_ADVANCE_V2,
        maxOutputs,
        { bounce: false, value: ton("0.1") },
    );
}

fun batchExpectInvalidInstruction(word: uint16, deployer: address, queryId: uint64) {
    val core = TonolithCoreV2.fromStorage(batchStorage(batchRom(word), emptyV2RecordRoot()));
    expect(core.deploy(deployer, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    expect(batchAdvanceWithQuery(core, deployer, queryId)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });
}

fun batchAdvancedEvent(result: SendResultList): V2BatchAdvanced {
    val event = result.findExternalOutMessage<V2BatchAdvanced>()!;
    return match (event.body) {
        TlbEitherLeft => event.body.value,
        TlbEitherRight => event.body.value.load(),
    };
}

fun batchOutputCommittedEvent(result: SendResultList): V2OutputCommitted {
    val event = result.findExternalOutMessage<V2OutputCommitted>()!;
    return match (event.body) {
        TlbEitherLeft => event.body.value,
        TlbEitherRight => event.body.value.load(),
    };
}

fun batchStopReason(result: SendResultList): uint8 {
    val event = result.findExternalOutMessage<V2BatchAdvanced>()!;
    return match (event.body) {
        TlbEitherLeft => event.body.value.stopReason,
        TlbEitherRight => event.body.value.load().stopReason,
    };
}

fun batchOutput(sequence: uint8): cell {
    return V2OutputRecord {
        domain: DOMAIN_OUTPUT_V2,
        outputId: (sequence as uint256) + 1,
        sourceCoreId: 0,
        destinationCoreId: 1,
        sourceEpoch: 0,
        destinationEpoch: 1,
        sourcePort: 0,
        destinationPort: 0,
        sequence,
        value: 0,
        sourceInstructionCount: 0,
        sourceStateHash: 0,
    }.toCell();
}

fun batchAppendOutputs(root: cell, remaining: int): cell {
    if (remaining == 0) {
        return root;
    }
    return batchAppendOutputs(
        v2AppendQueueRoot(root, batchOutput((remaining - 1) as uint8)),
        remaining - 1,
    );
}

fun batchOutboxStorage(initialCount: int): V2Storage {
    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 3,
        destinationCoreId: 1,
        destinationPort: 4,
        delay: 1,
        maxRecordsPerEpoch: 16,
    };
    var storage = batchStorage(
        batchRom(0xF03A),
        v2AppendQueueRoot(emptyV2RecordRoot(), route.toCell()),
    );
    var core = storage.core.load();
    var queues = core.queues.load();
    queues.outboxRoot = batchAppendOutputs(queues.outboxRoot, initialCount);
    core.queues = queues.toCell();
    storage.core = core.toCell();
    return storage;
}

fun batchAssertOutboxAppendCase(initialCount: int, deployer: address) {
    val core = TonolithCoreV2.fromStorage(batchOutboxStorage(initialCount));
    expect(core.deploy(deployer, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    val result = batchAdvanceWithQuery(core, deployer, initialCount as uint64);
    expect(result).toHaveSuccessfulTx<V2Advance>();
    expect(batchOutputCommittedEvent(result).outputId).toEqual(
        v2OutputId(
            0,
            0,
            1,
            0,
            1,
            3,
            4,
            0,
            0,
            1,
        ),
    );
    expect(core.getOutboxCountV2()).toEqual(initialCount + 1);
}

fun batchMalformedRouteRoot(): cell {
    val filler = V2Route {
        domain: 0,
        sourceCoreId: 9,
        sourcePort: 9,
        destinationCoreId: 9,
        destinationPort: 9,
        delay: 1,
        maxRecordsPerEpoch: 4,
    }.toCell();
    var root = emptyV2RecordRoot();
    repeat (16) {
        root = v2AppendQueueRoot(root, filler);
    }
    var slice = root.beginParse();
    slice.loadUint(5);
    return v2BuildQueueRoot(
        17,
        slice.loadRef(),
        slice.loadRef(),
        slice.loadRef(),
        slice.loadRef(),
    );
}

fun batchMalformedPeerRoot(): cell {
    val filler = V2Peer {
        domain: 0,
        coreId: 9,
        peerAddress: testing.treasury("v2-batch-unused-peer").address,
    }.toCell();
    var root = emptyV2RecordRoot();
    repeat (16) {
        root = v2AppendQueueRoot(root, filler);
    }
    var slice = root.beginParse();
    slice.loadUint(5);
    return v2BuildQueueRoot(
        17,
        slice.loadRef(),
        slice.loadRef(),
        slice.loadRef(),
        slice.loadRef(),
    );
}

fun runBatchCaseNop() {
    val deployer = testing.treasury("v2-batch-nop");
    val core = TonolithCoreV2.fromStorage(batchStorage(batchRom(0), emptyV2RecordRoot()));
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    batchAdvance(core, deployer.address);

    expect(core.getInstructionCountV2()).toEqual(MAX_STEPS_PER_ADVANCE_V2);
    expect(core.getAdvanceCountV2()).toEqual(1);
    expect(core.getAcceptedMessageCountV2()).toEqual(1);
    expect(core.getStatusV2()).toEqual(STATUS_RUNNING_V2);
}

fun runBatchCaseQueuePages() {
    val deployer = testing.treasury("v2-batch-queue-append-pages");
    batchAssertOutboxAppendCase(4, deployer.address);
    batchAssertOutboxAppendCase(5, deployer.address);
    batchAssertOutboxAppendCase(6, deployer.address);
    batchAssertOutboxAppendCase(7, deployer.address);
    batchAssertOutboxAppendCase(8, deployer.address);
    batchAssertOutboxAppendCase(9, deployer.address);
    batchAssertOutboxAppendCase(10, deployer.address);
    batchAssertOutboxAppendCase(11, deployer.address);
    batchAssertOutboxAppendCase(12, deployer.address);
    batchAssertOutboxAppendCase(13, deployer.address);
}

fun runBatchCaseDeltaAccounting() {
    val deployer = testing.treasury("v2-batch-delta-accounting");
    var storage = batchStorage(batchRom(0), emptyV2RecordRoot());
    var initialCore = storage.core.load();
    initialCore.instructionCount = 4;
    initialCore.outputCount = 3;
    storage.core = initialCore.toCell();
    val previousStateHash = storage.core.hash();
    var expectedCore = initialCore;
    val _ignoredExpectedOutput = v2ExecuteInstruction(
        mutate expectedCore,
        0,
        0,
        0,
        emptyV2RecordRoot(),
        previousStateHash,
    );
    val expectedTrace = nextV2TraceCommitment(previousStateHash, 0, expectedCore.toCell().hash());
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    val result = batchAdvanceWithQuery(core, deployer.address, 7);
    expect(result).toHaveSuccessfulTx<V2Advance>();
    val event = batchAdvancedEvent(result);
    expect(event.startInstructionCount).toEqual(4);
    expect(event.endInstructionCount).toEqual(5);
    expect(event.stepsExecuted).toEqual(1);
    expect(event.outputsProduced).toEqual(0);
    val detail = event.detail.load();
    expect(detail.batchCommitment).toEqual(
        nextV2BatchCommitment(
            previousStateHash,
            detail.nextStateHash,
            4,
            5,
            1,
            0,
            STOP_REQUEST_LIMIT_V2,
            expectedTrace,
        ),
    );
}

fun runBatchCaseIsaFamilies() {
    val deployer = testing.treasury("v2-batch-isa-families");
    val core = TonolithCoreV2.fromStorage(batchStorage(batchIsaRom(), emptyV2RecordRoot()));
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    batchAdvance(core, deployer.address);

    expect(core.getInstructionCountV2()).toEqual(MAX_STEPS_PER_ADVANCE_V2);
    expect(core.getOutputCountV2()).toEqual(0);
    expect(core.getStatusV2()).toEqual(STATUS_RUNNING_V2);
}

fun runBatchCaseLegacyOutput() {
    val deployer = testing.treasury("v2-batch-legacy-output");
    val core = TonolithCoreV2.fromStorage(batchStorage(batchRom(0xF001), emptyV2RecordRoot()));
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    val result = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        1,
        0,
        0,
        core.getCoreStateHashV2(),
        MAX_STEPS_PER_ADVANCE_V2,
        1,
        { bounce: false, value: ton("0.1") },
    );
    expect(result).toHaveSuccessfulTx<V2Advance>();
    expect(core.getInstructionCountV2()).toEqual(1);
    expect(core.getOutputCountV2()).toEqual(1);
}

fun runBatchCaseRomLevel() {
    val deployer = testing.treasury("v2-batch-rom-level");
    val core = TonolithCoreV2.fromStorage(batchStorage(batchRom(0x1007), emptyV2RecordRoot()));
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    batchAdvance(core, deployer.address);

    expect(core.getInstructionCountV2()).toEqual(1);
    expect(core.getAccumulatorV2()).toEqual(7);
    expect(core.getPcV2()).toEqual(1);
}

fun runBatchCaseRomSelector() {
    val deployer = testing.treasury("v2-batch-rom-selector");
    var storage = batchStorage(
        batchRomWithLevel1Word(0x1007),
        emptyV2RecordRoot(),
    );
    var initialCore = storage.core.load();
    initialCore.pc = 384;
    storage.core = initialCore.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    batchAdvance(core, deployer.address);

    expect(core.getInstructionCountV2()).toEqual(1);
    expect(core.getAccumulatorV2()).toEqual(7);
    expect(core.getPcV2()).toEqual(385);
}

fun runBatchCaseRomBoundaries() {
    val deployer = testing.treasury("v2-batch-rom-boundaries");
    val rom = batchRomSelectorBoundaries();
    expect(batchRunAtPc(rom, 0, deployer.address).getAccumulatorV2()).toEqual(1);
    expect(batchRunAtPc(rom, 1, deployer.address).getAccumulatorV2()).toEqual(9);
    expect(batchRunAtPc(rom, 16, deployer.address).getAccumulatorV2()).toEqual(5);
    expect(batchRunAtPc(rom, 32, deployer.address).getAccumulatorV2()).toEqual(2);
    expect(batchRunAtPc(rom, 64, deployer.address).getAccumulatorV2()).toEqual(3);
    expect(batchRunAtPc(rom, 96, deployer.address).getAccumulatorV2()).toEqual(4);
    expect(batchRunAtPc(rom, 128, deployer.address).getAccumulatorV2()).toEqual(6);
    expect(batchRunAtPc(rom, 256, deployer.address).getAccumulatorV2()).toEqual(7);
    expect(batchRunAtPc(rom, 384, deployer.address).getAccumulatorV2()).toEqual(8);
}

fun runBatchCaseOpcodeDistinctions() {
    val deployer = testing.treasury("v2-batch-opcode-distinction");

    val nop = batchRunAtPc(batchRom(0x0000), 0, deployer.address);
    expect(nop.getPcV2()).toEqual(1);

    val ldi = batchRunAtPc(batchRom(0x100E), 0, deployer.address);
    expect(ldi.getAccumulatorV2()).toEqual(14);
    expect(ldi.getFlagsV2() & FLAG_ZERO_V2).toEqual(0);

    var ldrStorage = batchStorage(batchRom(0x2000), emptyV2RecordRoot());
    var ldrState = ldrStorage.core.load();
    var ldrMemory = ldrState.memory.load();
    ldrMemory.registers = V2Registers { packed: 0xA }.toCell();
    ldrState.memory = ldrMemory.toCell();
    ldrStorage.core = ldrState.toCell();
    val ldr = batchRunStorage(ldrStorage, deployer.address);
    expect(ldr.getAccumulatorV2()).toEqual(0xA);

    var strStorage = batchStorage(batchRom(0x3000), emptyV2RecordRoot());
    var strState = strStorage.core.load();
    strState.accumulator = 0xB;
    strStorage.core = strState.toCell();
    val str = batchRunStorage(strStorage, deployer.address);
    expect(str.getRegistersV2() & 15).toEqual(0xB);

    var addStorage = batchStorage(batchRom(0x4000), emptyV2RecordRoot());
    var addState = addStorage.core.load();
    addState.accumulator = 1;
    var addMemory = addState.memory.load();
    addMemory.registers = V2Registers { packed: 2 }.toCell();
    addState.memory = addMemory.toCell();
    addStorage.core = addState.toCell();
    val add = batchRunStorage(addStorage, deployer.address);
    expect(add.getAccumulatorV2()).toEqual(3);

    var adcStorage = batchStorage(batchRom(0x5000), emptyV2RecordRoot());
    var adcState = adcStorage.core.load();
    adcState.accumulator = 1;
    adcState.flags = FLAG_CARRY_V2;
    var adcMemory = adcState.memory.load();
    adcMemory.registers = V2Registers { packed: 2 }.toCell();
    adcState.memory = adcMemory.toCell();
    adcStorage.core = adcState.toCell();
    val adc = batchRunStorage(adcStorage, deployer.address);
    expect(adc.getAccumulatorV2()).toEqual(4);

    var subStorage = batchStorage(batchRom(0x6000), emptyV2RecordRoot());
    var subState = subStorage.core.load();
    subState.accumulator = 1;
    var subMemory = subState.memory.load();
    subMemory.registers = V2Registers { packed: 2 }.toCell();
    subState.memory = subMemory.toCell();
    subStorage.core = subState.toCell();
    val sub = batchRunStorage(subStorage, deployer.address);
    expect(sub.getAccumulatorV2()).toEqual(15);

    var andStorage = batchStorage(batchRom(0x7000), emptyV2RecordRoot());
    var andState = andStorage.core.load();
    andState.accumulator = 0xA;
    var andMemory = andState.memory.load();
    andMemory.registers = V2Registers { packed: 3 }.toCell();
    andState.memory = andMemory.toCell();
    andStorage.core = andState.toCell();
    expect(batchRunStorage(andStorage, deployer.address).getAccumulatorV2()).toEqual(2);

    var orStorage = batchStorage(batchRom(0x8000), emptyV2RecordRoot());
    var orState = orStorage.core.load();
    orState.accumulator = 8;
    var orMemory = orState.memory.load();
    orMemory.registers = V2Registers { packed: 3 }.toCell();
    orState.memory = orMemory.toCell();
    orStorage.core = orState.toCell();
    expect(batchRunStorage(orStorage, deployer.address).getAccumulatorV2()).toEqual(11);

    var xorStorage = batchStorage(batchRom(0x9000), emptyV2RecordRoot());
    var xorState = xorStorage.core.load();
    xorState.accumulator = 0xA;
    var xorMemory = xorState.memory.load();
    xorMemory.registers = V2Registers { packed: 3 }.toCell();
    xorState.memory = xorMemory.toCell();
    xorStorage.core = xorState.toCell();
    expect(batchRunStorage(xorStorage, deployer.address).getAccumulatorV2()).toEqual(9);

    var ldmStorage = batchStorage(batchRom(0xA000), emptyV2RecordRoot());
    var ldmState = ldmStorage.core.load();
    writeV2Ram(mutate ldmState, 0, 6);
    ldmStorage.core = ldmState.toCell();
    expect(batchRunStorage(ldmStorage, deployer.address).getAccumulatorV2()).toEqual(6);

    var stmStorage = batchStorage(batchRom(0xB000), emptyV2RecordRoot());
    var stmState = stmStorage.core.load();
    stmState.accumulator = 7;
    stmStorage.core = stmState.toCell();
    expect(batchRunStorage(stmStorage, deployer.address).getMemoryPageV2(0) & 15).toEqual(7);

    expect(batchRunAtPc(batchRom(0xC123), 0, deployer.address).getPcV2()).toEqual(0x123);

    var jzTakenStorage = batchStorage(batchRom(0xD123), emptyV2RecordRoot());
    var jzTakenState = jzTakenStorage.core.load();
    jzTakenState.flags = FLAG_ZERO_V2;
    jzTakenStorage.core = jzTakenState.toCell();
    expect(batchRunStorage(jzTakenStorage, deployer.address).getPcV2()).toEqual(0x123);
    expect(batchRunAtPc(batchRom(0xD123), 0, deployer.address).getPcV2()).toEqual(1);

    var jcTakenStorage = batchStorage(batchRom(0xE123), emptyV2RecordRoot());
    var jcTakenState = jcTakenStorage.core.load();
    jcTakenState.flags = FLAG_CARRY_V2;
    jcTakenStorage.core = jcTakenState.toCell();
    expect(batchRunStorage(jcTakenStorage, deployer.address).getPcV2()).toEqual(0x123);
    expect(batchRunAtPc(batchRom(0xE123), 0, deployer.address).getPcV2()).toEqual(1);
}

fun runBatchCaseArithmeticBoundaries() {
    val deployer = testing.treasury("v2-batch-arithmetic-boundaries");

    var incStorage = batchStorage(batchRom(0xF007), emptyV2RecordRoot());
    var incState = incStorage.core.load();
    incState.accumulator = 15;
    incStorage.core = incState.toCell();
    val inc = batchRunStorage(incStorage, deployer.address);
    expect(inc.getAccumulatorV2()).toEqual(0);
    expect(inc.getFlagsV2()).toEqual(FLAG_ZERO_V2 | FLAG_CARRY_V2);

    var decStorage = batchStorage(batchRom(0xF008), emptyV2RecordRoot());
    var decState = decStorage.core.load();
    decState.accumulator = 0;
    decStorage.core = decState.toCell();
    val dec = batchRunStorage(decStorage, deployer.address);
    expect(dec.getAccumulatorV2()).toEqual(15);
    expect(dec.getFlagsV2()).toEqual(0);

    var shlStorage = batchStorage(batchRom(0xF005), emptyV2RecordRoot());
    var shlState = shlStorage.core.load();
    shlState.accumulator = 8;
    shlStorage.core = shlState.toCell();
    val shl = batchRunStorage(shlStorage, deployer.address);
    expect(shl.getAccumulatorV2()).toEqual(0);
    expect(shl.getFlagsV2()).toEqual(FLAG_ZERO_V2 | FLAG_CARRY_V2);

    var shrStorage = batchStorage(batchRom(0xF006), emptyV2RecordRoot());
    var shrState = shrStorage.core.load();
    shrState.accumulator = 1;
    shrStorage.core = shrState.toCell();
    val shr = batchRunStorage(shrStorage, deployer.address);
    expect(shr.getAccumulatorV2()).toEqual(0);
    expect(shr.getFlagsV2()).toEqual(FLAG_ZERO_V2 | FLAG_CARRY_V2);

    var notStorage = batchStorage(batchRom(0xF004), emptyV2RecordRoot());
    var notState = notStorage.core.load();
    notState.accumulator = 15;
    notStorage.core = notState.toCell();
    val not = batchRunStorage(notStorage, deployer.address);
    expect(not.getAccumulatorV2()).toEqual(0);
    expect(not.getFlagsV2()).toEqual(FLAG_ZERO_V2);

    val stcStorage = batchStorage(batchRom(0xF003), emptyV2RecordRoot());
    val stc = batchRunStorage(stcStorage, deployer.address);
    expect(stc.getFlagsV2()).toEqual(FLAG_CARRY_V2);

    var clcStorage = batchStorage(batchRom(0xF002), emptyV2RecordRoot());
    var clcState = clcStorage.core.load();
    clcState.flags = FLAG_CARRY_V2;
    clcStorage.core = clcState.toCell();
    val clc = batchRunStorage(clcStorage, deployer.address);
    expect(clc.getFlagsV2()).toEqual(0);

    var addCarryStorage = batchStorage(batchRom(0x4000), emptyV2RecordRoot());
    var addCarryState = addCarryStorage.core.load();
    addCarryState.accumulator = 1;
    addCarryState.flags = FLAG_CARRY_V2;
    var addCarryMemory = addCarryState.memory.load();
    addCarryMemory.registers = V2Registers { packed: 2 }.toCell();
    addCarryState.memory = addCarryMemory.toCell();
    addCarryStorage.core = addCarryState.toCell();
    val addCarry = batchRunStorage(addCarryStorage, deployer.address);
    expect(addCarry.getAccumulatorV2()).toEqual(3);

    var adcNoCarryStorage = batchStorage(batchRom(0x5000), emptyV2RecordRoot());
    var adcNoCarryState = adcNoCarryStorage.core.load();
    adcNoCarryState.accumulator = 1;
    var adcNoCarryMemory = adcNoCarryState.memory.load();
    adcNoCarryMemory.registers = V2Registers { packed: 2 }.toCell();
    adcNoCarryState.memory = adcNoCarryMemory.toCell();
    adcNoCarryStorage.core = adcNoCarryState.toCell();
    val adcNoCarry = batchRunStorage(adcNoCarryStorage, deployer.address);
    expect(adcNoCarry.getAccumulatorV2()).toEqual(3);

    var exactAddStorage = batchStorage(batchRom(0x4000), emptyV2RecordRoot());
    var exactAddState = exactAddStorage.core.load();
    exactAddState.accumulator = 15;
    var exactAddMemory = exactAddState.memory.load();
    exactAddMemory.registers = V2Registers { packed: 1 }.toCell();
    exactAddState.memory = exactAddMemory.toCell();
    exactAddStorage.core = exactAddState.toCell();
    val exactAdd = batchRunStorage(exactAddStorage, deployer.address);
    expect(exactAdd.getAccumulatorV2()).toEqual(0);
    expect(exactAdd.getFlagsV2()).toEqual(FLAG_ZERO_V2 | FLAG_CARRY_V2);

    var exactSubStorage = batchStorage(batchRom(0x6000), emptyV2RecordRoot());
    var exactSubState = exactSubStorage.core.load();
    exactSubState.accumulator = 2;
    var exactSubMemory = exactSubState.memory.load();
    exactSubMemory.registers = V2Registers { packed: 2 }.toCell();
    exactSubState.memory = exactSubMemory.toCell();
    exactSubStorage.core = exactSubState.toCell();
    val exactSub = batchRunStorage(exactSubStorage, deployer.address);
    expect(exactSub.getAccumulatorV2()).toEqual(0);
    expect(exactSub.getFlagsV2()).toEqual(FLAG_ZERO_V2 | FLAG_CARRY_V2);

    val ldiBoundary = batchRunAtPc(batchRom(0x100F), 0, deployer.address);
    expect(ldiBoundary.getAccumulatorV2()).toEqual(15);
    var ldrBoundaryStorage = batchStorage(batchRom(0x200F), emptyV2RecordRoot());
    var ldrBoundaryState = ldrBoundaryStorage.core.load();
    var ldrBoundaryMemory = ldrBoundaryState.memory.load();
    ldrBoundaryMemory.registers = V2Registers { packed: (15 as uint64) << 60 }.toCell();
    ldrBoundaryState.memory = ldrBoundaryMemory.toCell();
    ldrBoundaryStorage.core = ldrBoundaryState.toCell();
    expect(batchRunStorage(ldrBoundaryStorage, deployer.address).getAccumulatorV2()).toEqual(15);

    var ldmBoundaryStorage = batchStorage(batchRom(0xA0FF), emptyV2RecordRoot());
    var ldmBoundaryState = ldmBoundaryStorage.core.load();
    writeV2Ram(mutate ldmBoundaryState, 255, 15);
    ldmBoundaryStorage.core = ldmBoundaryState.toCell();
    expect(batchRunStorage(ldmBoundaryStorage, deployer.address).getAccumulatorV2()).toEqual(15);

    var stmBoundaryStorage = batchStorage(batchRom(0xB0FF), emptyV2RecordRoot());
    var stmBoundaryState = stmBoundaryStorage.core.load();
    stmBoundaryState.accumulator = 15;
    stmBoundaryStorage.core = stmBoundaryState.toCell();
    expect(
        batchRunStorage(stmBoundaryStorage, deployer.address).getMemoryPageV2(3) >> 252,
    ).toEqual(15);

    expect(batchRunAtPc(batchRom(0xC3FF), 0, deployer.address).getPcV2()).toEqual(1023);
    var jzBoundaryStorage = batchStorage(batchRom(0xD3FF), emptyV2RecordRoot());
    var jzBoundaryState = jzBoundaryStorage.core.load();
    jzBoundaryState.flags = FLAG_ZERO_V2;
    jzBoundaryStorage.core = jzBoundaryState.toCell();
    expect(batchRunStorage(jzBoundaryStorage, deployer.address).getPcV2()).toEqual(1023);
    var jcBoundaryStorage = batchStorage(batchRom(0xE3FF), emptyV2RecordRoot());
    var jcBoundaryState = jcBoundaryStorage.core.load();
    jcBoundaryState.flags = FLAG_CARRY_V2;
    jcBoundaryStorage.core = jcBoundaryState.toCell();
    expect(batchRunStorage(jcBoundaryStorage, deployer.address).getPcV2()).toEqual(1023);

    batchExpectInvalidInstruction(0x2010, deployer.address, 20);
    batchExpectInvalidInstruction(0x9010, deployer.address, 21);
    batchExpectInvalidInstruction(0xA100, deployer.address, 22);
    batchExpectInvalidInstruction(0xB100, deployer.address, 23);
    batchExpectInvalidInstruction(0xC400, deployer.address, 24);
    batchExpectInvalidInstruction(0xE400, deployer.address, 25);
    batchExpectInvalidInstruction(0xF00D, deployer.address, 26);
}

fun runBatchCaseRamPages() {
    val deployer = testing.treasury("v2-batch-ram-page-boundaries");

    var page1Storage = batchStorage(batchRom(0xA07F), emptyV2RecordRoot());
    var page1State = page1Storage.core.load();
    writeV2Ram(mutate page1State, 127, 6);
    page1Storage.core = page1State.toCell();
    expect(batchRunStorage(page1Storage, deployer.address).getAccumulatorV2()).toEqual(6);

    var page2Storage = batchStorage(batchRom(0xA0BF), emptyV2RecordRoot());
    var page2State = page2Storage.core.load();
    writeV2Ram(mutate page2State, 191, 7);
    page2Storage.core = page2State.toCell();
    expect(batchRunStorage(page2Storage, deployer.address).getAccumulatorV2()).toEqual(7);
}

fun runBatchCaseRouteAndFees() {
    val deployer = testing.treasury("v2-batch-route-boundary");
    val wrongRoute = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 4,
        destinationCoreId: 1,
        destinationPort: 0,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    val core = TonolithCoreV2.fromStorage(
        batchStorage(batchRom(0xF03A), v2AppendQueueRoot(emptyV2RecordRoot(), wrongRoute.toCell())),
    );
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    expect(batchAdvanceWithQuery(core, deployer.address, 1)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidRoute,
    });
    expect(core.estimateRequiredValueV2(0)).toEqual(10000000);
    expect(core.estimateRequiredValueV2(1)).toEqual(20000000);
    expect(core.estimateRequiredValueV2(2)).toEqual(20000000);
    expect(core.estimateRequiredValueV2(3)).toEqual(0);
}

fun runBatchCaseDeliveryGuards() {
    val deployer = testing.treasury("v2-batch-delivery-route-guards");

    val destinationCoreRoute = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 0,
        destinationCoreId: 1,
        destinationPort: 2,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var destinationCoreStorage = batchStorageWithPeers(
        batchRom(0xF029),
        v2AppendQueueRoot(emptyV2RecordRoot(), destinationCoreRoute.toCell()),
        v2AppendQueueRoot(
            emptyV2RecordRoot(),
            V2Peer {
                domain: DOMAIN_PEER_V2,
                coreId: 1,
                peerAddress: deployer.address,
            }.toCell(),
        ),
    );
    var destinationCoreState = destinationCoreStorage.core.load();
    destinationCoreState.epoch = 1;
    destinationCoreState.status = STATUS_WAITING_INPUT_V2;
    destinationCoreStorage.core = destinationCoreState.toCell();
    val destinationCore = TonolithCoreV2.fromStorage(destinationCoreStorage);
    expect(destinationCore.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: destinationCore.address,
    });
    val mismatchedCoreId = v2OutputId(
        0,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        7,
        1,
    );
    expect(
        destinationCore.sendV2DeliverInput(
            deployer.address,
            ABI_VERSION_V2,
            1,
            0,
            mismatchedCoreId,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            V2Hash { value: 0 },
            { bounce: false, value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRoute });

    val destinationPortRoute = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 0,
        destinationCoreId: 0,
        destinationPort: 2,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var destinationPortStorage = batchStorageWithPeers(
        batchRom(0xF029),
        v2AppendQueueRoot(emptyV2RecordRoot(), destinationPortRoute.toCell()),
        v2AppendQueueRoot(
            emptyV2RecordRoot(),
            V2Peer {
                domain: DOMAIN_PEER_V2,
                coreId: 1,
                peerAddress: deployer.address,
            }.toCell(),
        ),
    );
    var destinationPortState = destinationPortStorage.core.load();
    destinationPortState.epoch = 1;
    destinationPortState.status = STATUS_WAITING_INPUT_V2;
    destinationPortStorage.core = destinationPortState.toCell();
    val destinationPort = TonolithCoreV2.fromStorage(destinationPortStorage);
    expect(destinationPort.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: destinationPort.address,
    });
    val mismatchedPortId = v2OutputId(
        0,
        1,
        0,
        0,
        1,
        0,
        3,
        0,
        7,
        1,
    );
    expect(
        destinationPort.sendV2DeliverInput(
            deployer.address,
            ABI_VERSION_V2,
            2,
            0,
            mismatchedPortId,
            1,
            0,
            0,
            1,
            0,
            3,
            0,
            7,
            1,
            V2Hash { value: 0 },
            { bounce: false, value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRoute });

    val mismatchedEpochId = v2OutputId(
        0,
        1,
        0,
        0,
        2,
        0,
        2,
        0,
        7,
        1,
    );
    expect(
        destinationPort.sendV2DeliverInput(
            deployer.address,
            ABI_VERSION_V2,
            3,
            0,
            mismatchedEpochId,
            1,
            0,
            0,
            2,
            0,
            2,
            0,
            7,
            1,
            V2Hash { value: 0 },
            { bounce: false, value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidEpoch });
}

fun runBatchCaseMalformedRoutes() {
    val deployer = testing.treasury("v2-batch-route-count-boundary");
    val peers = v2AppendQueueRoot(
        emptyV2RecordRoot(),
        V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }.toCell(),
    );
    val core = TonolithCoreV2.fromStorage(
        batchStorageWithPeers(batchRom(0xF029), batchMalformedRouteRoot(), peers),
    );
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    val outputId = v2OutputId(
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        7,
        1,
    );
    expect(
        core.sendV2DeliverInput(
            deployer.address,
            ABI_VERSION_V2,
            4,
            0,
            outputId,
            1,
            0,
            0,
            1,
            0,
            0,
            0,
            7,
            1,
            V2Hash { value: 0 },
            { bounce: false, value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });
}

fun runBatchCaseMalformedPeers() {
    val deployer = testing.treasury("v2-batch-peer-count-boundary");
    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 3,
        destinationCoreId: 1,
        destinationPort: 4,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    val core = TonolithCoreV2.fromStorage(
        batchStorageWithPeers(
            batchRom(0xF03A),
            v2AppendQueueRoot(emptyV2RecordRoot(), route.toCell()),
            batchMalformedPeerRoot(),
        ),
    );
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    expect(batchAdvanceWithQuery(core, deployer.address, 8)).toHaveSuccessfulTx<V2Advance>();
    val outputId = v2OutputId(
        0,
        0,
        1,
        0,
        1,
        3,
        4,
        0,
        0,
        1,
    );
    expect(
        core.sendV2DispatchOutput(
            deployer.address,
            ABI_VERSION_V2,
            9,
            0,
            core.getCoreStateHashV2(),
            outputId,
            { bounce: false, value: ton("0.1") },
        ),
    ).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidStorage,
    });
}

fun runBatchCaseNontrapSys() {
    val deployer = testing.treasury("v2-batch-nontrap-sys");
    val core = batchRunAtPc(batchRom(0xF002), 0, deployer.address);
    expect(core.getStatusV2()).toEqual(STATUS_RUNNING_V2);
    expect(core.getFlagsV2()).toEqual(0);
}

fun runBatchCaseOutputSequenceGetter() {
    val deployer = testing.treasury("v2-batch-output-sequence-getter");
    val core = batchRunAtPc(batchRom(0x1000), 0, deployer.address);
    expect(core.getOutputSequenceV2(0)).toEqual(0);
    expect(core.getOutputSequenceV2(15)).toEqual(0);
}

fun runBatchCaseRoutedOutput() {
    val deployer = testing.treasury("v2-batch-routed-output");
    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 3,
        destinationCoreId: 1,
        destinationPort: 4,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    val core = TonolithCoreV2.fromStorage(
        batchStorage(batchRom(0xF03A), v2AppendQueueRoot(emptyV2RecordRoot(), route.toCell())),
    );
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    val result = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        2,
        0,
        0,
        core.getCoreStateHashV2(),
        MAX_STEPS_PER_ADVANCE_V2,
        1,
        { bounce: false, value: ton("0.1") },
    );
    expect(result).toHaveSuccessfulTx<V2Advance>();
    expect(result).toEmitExternalMessage<V2OutputCommitted>();
    expect(core.getInstructionCountV2()).toEqual(1);
    expect(core.getOutboxCountV2()).toEqual(1);
}

fun runBatchCaseYieldAndTrap() {
    val deployer = testing.treasury("v2-batch-stop-controls");
    val yielded = TonolithCoreV2.fromStorage(batchStorage(batchRom(0xF00B), emptyV2RecordRoot()));
    expect(yielded.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: yielded.address,
    });
    batchAdvance(yielded, deployer.address);
    expect(yielded.getInstructionCountV2()).toEqual(1);
    expect(yielded.getEpochV2()).toEqual(1);
    expect(yielded.getStatusV2()).toEqual(STATUS_RUNNING_V2);

    val trapped = TonolithCoreV2.fromStorage(batchStorage(batchRom(0xF1AC), emptyV2RecordRoot()));
    expect(trapped.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: trapped.address,
    });
    batchAdvance(trapped, deployer.address);
    expect(trapped.getInstructionCountV2()).toEqual(1);
    expect(trapped.getStatusV2()).toEqual(STATUS_FAULTED_V2);
}

fun runBatchCaseStopReasons() {
    val requestDeployer = testing.treasury("v2-batch-stop-request");

    val requestLimit = TonolithCoreV2.fromStorage(batchStorage(batchRom(0), emptyV2RecordRoot()));
    expect(
        requestLimit.deploy(requestDeployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({
        to: requestLimit.address,
    });
    val requestLimitTx = batchAdvanceWithQuery(requestLimit, requestDeployer.address, 1);
    expect(requestLimitTx).toHaveSuccessfulTx<V2Advance>();
    expect(batchStopReason(requestLimitTx)).toEqual(STOP_REQUEST_LIMIT_V2);

    val haltedDeployer = testing.treasury("v2-batch-stop-halted");
    val halted = TonolithCoreV2.fromStorage(batchStorage(batchRom(0xF000), emptyV2RecordRoot()));
    expect(halted.deploy(haltedDeployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: halted.address,
    });
    val haltedTx = batchAdvanceWithQuery(halted, haltedDeployer.address, 2);
    expect(haltedTx).toHaveSuccessfulTx<V2Advance>();
    expect(batchStopReason(haltedTx)).toEqual(STOP_HALTED_V2);

    val faultedDeployer = testing.treasury("v2-batch-stop-faulted");
    val faulted = TonolithCoreV2.fromStorage(batchStorage(batchRom(0xF1AC), emptyV2RecordRoot()));
    expect(faulted.deploy(faultedDeployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: faulted.address,
    });
    val faultedTx = batchAdvanceWithQuery(faulted, faultedDeployer.address, 3);
    expect(faultedTx).toHaveSuccessfulTx<V2Advance>();
    expect(batchStopReason(faultedTx)).toEqual(STOP_FAULTED_V2);

    var waitingStorage = batchStorage(batchRom(0xF029), emptyV2RecordRoot());
    var waitingCore = waitingStorage.core.load();
    waitingCore.epoch = 1;
    waitingStorage.core = waitingCore.toCell();
    val waitingDeployer = testing.treasury("v2-batch-stop-waiting");
    val waiting = TonolithCoreV2.fromStorage(waitingStorage);
    expect(waiting.deploy(waitingDeployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: waiting.address,
    });
    val waitingTx = batchAdvanceWithQuery(waiting, waitingDeployer.address, 4);
    expect(waitingTx).toHaveSuccessfulTx<V2Advance>();
    expect(batchStopReason(waitingTx)).toEqual(STOP_INPUT_UNAVAILABLE_V2);

    var backpressureStorage = batchStorage(batchRom(0xF03A), emptyV2RecordRoot());
    var backpressureCore = backpressureStorage.core.load();
    var backpressureQueues = backpressureCore.queues.load();
    repeat (16) {
        backpressureQueues.outboxRoot = v2AppendQueueRoot(
            backpressureQueues.outboxRoot,
            batchOutput(0),
        );
    }
    backpressureCore.queues = backpressureQueues.toCell();
    backpressureStorage.core = backpressureCore.toCell();
    val backpressureDeployer = testing.treasury("v2-batch-stop-backpressure");
    val backpressured = TonolithCoreV2.fromStorage(backpressureStorage);
    expect(
        backpressured.deploy(backpressureDeployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({
        to: backpressured.address,
    });
    val backpressuredTx = batchAdvanceWithQuery(backpressured, backpressureDeployer.address, 5);
    expect(backpressuredTx).toHaveSuccessfulTx<V2Advance>();
    expect(batchStopReason(backpressuredTx)).toEqual(STOP_OUTPUT_BACKPRESSURE_V2);

    val yieldDeployer = testing.treasury("v2-batch-stop-yielded");
    val yielded = TonolithCoreV2.fromStorage(batchStorage(batchRom(0xF00B), emptyV2RecordRoot()));
    expect(yielded.deploy(yieldDeployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: yielded.address,
    });
    val yieldedTx = batchAdvanceWithQuery(yielded, yieldDeployer.address, 6);
    expect(yieldedTx).toHaveSuccessfulTx<V2Advance>();
    expect(batchStopReason(yieldedTx)).toEqual(STOP_YIELDED_V2);
}

fun runBatchCaseInputWait() {
    val deployer = testing.treasury("v2-batch-input-wait");
    var storage = batchStorage(batchRom(0xF029), emptyV2RecordRoot());
    var initialCore = storage.core.load();
    initialCore.epoch = 1;
    storage.core = initialCore.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    batchAdvance(core, deployer.address);

    expect(core.getInstructionCountV2()).toEqual(0);
    expect(core.getAdvanceCountV2()).toEqual(1);
    expect(core.getStatusV2()).toEqual(STATUS_WAITING_INPUT_V2);
}

fun runBatchCaseOutputBackpressure() {
    val deployer = testing.treasury("v2-batch-output-backpressure");
    var storage = batchStorage(batchRom(0xF03A), emptyV2RecordRoot());
    var initialCore = storage.core.load();
    var queues = initialCore.queues.load();
    repeat (16) {
        queues.outboxRoot = v2AppendQueueRoot(queues.outboxRoot, batchOutput(0));
    }
    initialCore.queues = queues.toCell();
    storage.core = initialCore.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });

    batchAdvance(core, deployer.address);

    expect(core.getInstructionCountV2()).toEqual(0);
    expect(core.getAdvanceCountV2()).toEqual(1);
    expect(core.getStatusV2()).toEqual(STATUS_BACKPRESSURED_V2);
    expect(core.getOutboxCountV2()).toEqual(16);
}

get fun `test v2 grouped execution and memory boundaries`() {
    runBatchCaseNop();
    runBatchCaseQueuePages();
    runBatchCaseDeltaAccounting();
    runBatchCaseIsaFamilies();
    runBatchCaseLegacyOutput();
    runBatchCaseRomLevel();
    runBatchCaseRomSelector();
}

get fun `test v2 grouped ROM and ISA boundaries`() {
    runBatchCaseRomBoundaries();
    runBatchCaseOpcodeDistinctions();
    runBatchCaseArithmeticBoundaries();
    runBatchCaseRamPages();
}

get fun `test v2 grouped route and delivery guards`() {
    runBatchCaseRouteAndFees();
    runBatchCaseDeliveryGuards();
    runBatchCaseMalformedRoutes();
    runBatchCaseMalformedPeers();
}

get fun `test v2 grouped architectural stop paths`() {
    runBatchCaseNontrapSys();
    runBatchCaseOutputSequenceGetter();
    runBatchCaseRoutedOutput();
    runBatchCaseYieldAndTrap();
    runBatchCaseInputWait();
    runBatchCaseOutputBackpressure();
}

get fun `test v2 architectural stop reason events`() {
    runBatchCaseStopReasons();
}
