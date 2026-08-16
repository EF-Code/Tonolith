import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@contracts/TonolithCoreV2"
import "@wrappers/TonolithCoreV2.gen"
import "@contracts/v2/commitments"
import "@contracts/v2/execution"
import "@contracts/v2/memory"
import "@contracts/v2/peers"
import "@contracts/v2/queues"
import "@contracts/v2/rom"
import "@contracts/v2/routes"
import "@contracts/v2/types"

fun makeV2StorageForTest(rom: Cell<V2RomRoot>): V2Storage {
    return makeV2StorageForNetwork(rom, emptyV2RecordRoot(), emptyV2RecordRoot());
}

fun makeV2StorageForNetwork(rom: Cell<V2RomRoot>, routes: cell, peers: cell): V2Storage {
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

fun oneRouteV2(route: V2Route): cell {
    return v2AppendQueueRoot(emptyV2RecordRoot(), route.toCell());
}

fun onePeerV2(peer: V2Peer): cell {
    return v2AppendQueueRoot(emptyV2RecordRoot(), peer.toCell());
}

fun romWithFirstWordV2(word: uint16): Cell<V2RomRoot> {
    return v2RomWithFirstLeaf(
        V2RomLeaf {
            firstHalf: (word as uint256) << 240,
            secondHalf: 0,
        }.toCell(),
    );
}

fun outputRecordV2ForTest(sequence: uint8): cell {
    return V2OutputRecord {
        domain: DOMAIN_OUTPUT_V2,
        outputId: (sequence as uint256) + 100,
        sourceCoreId: 0,
        destinationCoreId: 1,
        sourceEpoch: 0,
        destinationEpoch: 1,
        sourcePort: 0,
        destinationPort: 0,
        sequence,
        value: 1,
        sourceInstructionCount: 1,
        sourceStateHash: 0,
    }.toCell();
}

fun inputRecordV2ForTest(epoch: uint64, port: uint4, sequence: uint8, outputId: uint256): cell {
    return V2InputRecord {
        domain: DOMAIN_INPUT_V2,
        outputId,
        sourceCoreId: 1,
        destinationCoreId: 0,
        sourceEpoch: epoch - 1,
        destinationEpoch: epoch,
        sourcePort: 0,
        destinationPort: port,
        sequence,
        value: 1,
        sourceInstructionCount: 1,
        sourceStateHash: 2,
        consumed: 0,
    }.toCell();
}

fun sendAdvanceV2ForTest(
    core: TonolithCoreV2,
    from: address,
    queryId: uint64,
    runId: uint256,
    expectedAdvanceCount: uint64,
    expectedStateHash: uint256,
    maxInstructions: uint16,
    maxOutputs: uint8,
    value: coins,
): SendResultList {
    val advanceMessage = createMessage({
        bounce: false,
        value,
        dest: core.address,
        body: V2Advance {
            abiVersion: ABI_VERSION_V2,
            queryId,
            runId,
            expectedAdvanceCount,
            expectedStateHash,
            maxInstructions,
            maxOutputs,
        },
    });
    return net.send(from, advanceMessage);
}

fun sendDeliverInputV2ForTest(
    core: TonolithCoreV2,
    from: address,
    queryId: uint64,
    runId: uint256,
    outputId: uint256,
    sourceCoreId: uint16,
    destinationCoreId: uint16,
    sourceEpoch: uint64,
    destinationEpoch: uint64,
    sourcePort: uint4,
    destinationPort: uint4,
    sequence: uint8,
    value: uint4,
    sourceInstructionCount: uint64,
    sourceStateHash: uint256,
): SendResultList {
    val deliverMessage = createMessage({
        bounce: false,
        value: ton("0.1"),
        dest: core.address,
        body: V2DeliverInput {
            abiVersion: ABI_VERSION_V2,
            queryId,
            runId,
            outputId,
            sourceCoreId,
            destinationCoreId,
            sourceEpoch,
            destinationEpoch,
            sourcePort,
            destinationPort,
            sequence,
            value,
            sourceInstructionCount,
            sourceState: V2Hash { value: sourceStateHash }.toCell(),
        },
    });
    return net.send(from, deliverMessage);
}

fun sendDeliverInputV2WithConfig(
    core: TonolithCoreV2,
    from: address,
    abiVersion: uint16,
    messageValue: coins,
    queryId: uint64,
    runId: uint256,
    outputId: uint256,
    sourceCoreId: uint16,
    destinationCoreId: uint16,
    sourceEpoch: uint64,
    destinationEpoch: uint64,
    sourcePort: uint4,
    destinationPort: uint4,
    sequence: uint8,
    value: uint4,
    sourceInstructionCount: uint64,
    sourceStateHash: uint256,
): SendResultList {
    return core.sendV2DeliverInput(
        from,
        abiVersion,
        queryId,
        runId,
        outputId,
        sourceCoreId,
        destinationCoreId,
        sourceEpoch,
        destinationEpoch,
        sourcePort,
        destinationPort,
        sequence,
        value,
        sourceInstructionCount,
        V2Hash { value: sourceStateHash },
        { bounce: false, value: messageValue },
    );
}

fun sendInputAcceptedV2ForTest(
    core: TonolithCoreV2,
    from: address,
    queryId: uint64,
    runId: uint256,
    outputId: uint256,
    destinationCoreId: uint16,
    destinationEpoch: uint64,
    destinationStateHash: uint256,
): SendResultList {
    val acknowledgement = createMessage({
        bounce: false,
        value: ton("0.1"),
        dest: core.address,
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
    return net.send(from, acknowledgement);
}

fun advanceV2OnceForTest(core: TonolithCoreV2, from: address): SendResultList {
    return sendAdvanceV2ForTest(
        core,
        from,
        0,
        core.getRunIdV2(),
        core.getAdvanceCountV2(),
        core.getCoreStateHashV2(),
        1,
        1,
        ton("0.1"),
    );
}

get fun `test v2 deploy exposes immutable metadata and a canonical initial state`() {
    val deployer = testing.treasury("v2-metadata-deployer");
    val core = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x0000)));
    expect(
        core.deploy(deployer.address, SendParams { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: core.address });

    expect(core.getMagicV2()).toEqual(0x544E4C32);
    expect(core.getSchemaVersionV2()).toEqual(2);
    expect(core.getIsaVersionV2()).toEqual(2);
    expect(core.getAbiVersionV2()).toEqual(2);
    expect(core.getProtocolVersionV2()).toEqual(2);
    expect(core.getCoreIdV2()).toEqual(0);
    expect(core.getStatusV2()).toEqual(0);
    expect(core.getEpochV2()).toEqual(0);
    expect(core.getInstructionCountV2()).toEqual(0);
    expect(
        core.getCoreStateHashV2(),
    ).toEqual(0x0782faed379592a6d47134282b8c495e6073033acb733ed5e629f8b24ddb14b9);
}

get fun `test v2 advance executes a canonical instruction and rejects stale state`() {
    val deployer = testing.treasury("v2-advance-deployer");
    val core = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x1001)));
    expect(
        core.deploy(deployer.address, SendParams { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: core.address });
    val initialHash = core.getCoreStateHashV2();
    val wire = V2Advance {
        abiVersion: ABI_VERSION_V2,
        queryId: 17,
        runId: 0,
        expectedAdvanceCount: 0,
        expectedStateHash: initialHash,
        maxInstructions: 1,
        maxOutputs: 1,
    }.toCell();
    expect(
        V2Advance.fromSlice(wire.beginParse(), { assertEndAfterReading: true }).abiVersion,
    ).toEqual(2);
    val first = sendAdvanceV2ForTest(
        core,
        deployer.address,
        17,
        0,
        0,
        initialHash,
        1,
        1,
        ton("0.1"),
    );
    expect(first).toHaveSuccessfulTx<V2Advance>();
    expect(core.getInstructionCountV2()).toEqual(1);
    expect(core.getAdvanceCountV2()).toEqual(1);
    expect(core.getAccumulatorV2()).toEqual(1);
    expect(core.getPcV2()).toEqual(1);
    expect(
        core.getCoreStateHashV2(),
    ).toEqual(0xf05071c3bb072ab16ebe16a348fe1548ac806319b8cb95b284db1fce74e8694d);
    val advancedHash = core.getCoreStateHashV2();
    expect(advancedHash).toNotEqual(initialHash);

    val stale = sendAdvanceV2ForTest(
        core,
        deployer.address,
        17,
        0,
        0,
        initialHash,
        1,
        1,
        ton("0.1"),
    );
    expect(stale).toHaveFailedTx({
        from: deployer.address,
        to: core.address,
        exitCode: ErrorsV2.StaleAdvance,
    });
    expect(core.getCoreStateHashV2()).toEqual(advancedHash);
}

get fun `test v2 HALT is an architectural state and rejects subsequent advance`() {
    val deployer = testing.treasury("v2-halt-deployer");
    val core = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF000)));
    expect(
        core.deploy(deployer.address, SendParams { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: core.address });
    val first = sendAdvanceV2ForTest(
        core,
        deployer.address,
        0,
        0,
        0,
        core.getCoreStateHashV2(),
        1,
        1,
        ton("0.1"),
    );
    expect(first).toHaveSuccessfulTx<V2Advance>();
    expect(core.getStatusV2()).toEqual(3);
    val halted = sendAdvanceV2ForTest(
        core,
        deployer.address,
        1,
        0,
        1,
        core.getCoreStateHashV2(),
        1,
        1,
        ton("0.1"),
    );
    expect(halted).toHaveFailedTx({
        from: deployer.address,
        to: core.address,
        exitCode: ErrorsV2.InvalidStatus,
    });
}

get fun `test v2 OUTP appends a routed output and commits it`() {
    val deployer = testing.treasury("v2-outp-deployer");
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
        makeV2StorageForNetwork(
            romWithFirstWordV2(0xF03A),
            oneRouteV2(route),
            onePeerV2(V2Peer {
                domain: DOMAIN_PEER_V2,
                coreId: 1,
                peerAddress: deployer.address,
            }),
        ),
    );
    expect(
        core.deploy(deployer.address, SendParams { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: core.address });
    val result = sendAdvanceV2ForTest(
        core,
        deployer.address,
        3,
        0,
        0,
        core.getCoreStateHashV2(),
        1,
        1,
        ton("0.1"),
    );
    expect(result).toHaveSuccessfulTx<V2Advance>();
    expect(result).toEmitExternalMessage<V2OutputCommitted>();
    expect(core.getOutputCountV2()).toEqual(1);
    expect(core.getOutboxCountV2()).toEqual(1);
    expect(core.getAccumulatorV2()).toEqual(0);
    expect(core.getInstructionCountV2()).toEqual(1);
    expect(core.getOutputCommitmentV2()).toEqual(
        0xbef05e20c0bfad82f96fadd6cd4d085e08d26804ae52ec28d063f48d48fe886b,
    );
    expect(core.getCoreStateHashV2()).toEqual(
        0x0eed2e36924e740c884530155b6c8f079f1e342a2ff3ee0a1b7b672ba88c7c42,
    );
    val dispatch = core.sendV2DispatchOutput(
        deployer.address,
        ABI_VERSION_V2,
        4,
        0,
        core.getCoreStateHashV2(),
        0x18f93e46534eae22589575988cee189065e808d771d9eb925991245077a826fe,
        { bounce: false, value: ton("0.1") },
    );
    expect(dispatch).toHaveSuccessfulTx<V2DispatchOutput>();
    expect(core.getOutboxCountV2()).toEqual(1);
    val invalidDispatch = core.sendV2DispatchOutput(
        deployer.address,
        1,
        5,
        0,
        core.getCoreStateHashV2(),
        0,
        { bounce: false, value: ton("0.1") },
    );
    expect(invalidDispatch).toHaveFailedTx({ exitCode: ErrorsV2.InvalidVersion });
    val missingDispatch = core.sendV2DispatchOutput(
        deployer.address,
        ABI_VERSION_V2,
        6,
        0,
        core.getCoreStateHashV2(),
        1,
        { bounce: false, value: ton("0.1") },
    );
    expect(missingDispatch).toHaveFailedTx({ exitCode: ErrorsV2.NotFound });
    val rawMissingDispatch = core.sendAny(
        deployer.address,
        V2DispatchOutput {
            abiVersion: ABI_VERSION_V2,
            queryId: 7,
            runId: 0,
            expectedStateHash: core.getCoreStateHashV2(),
            outputId: 1,
        }.toCell(),
        { bounce: false, value: ton("0.1") },
    );
    expect(rawMissingDispatch).toHaveFailedTx({ exitCode: ErrorsV2.NotFound });
    val encodedMissingDispatch = core.sendAny(
        deployer.address,
        beginCell()
            .storeUint(MESSAGE_DISPATCH_OUTPUT_V2, 32)
            .storeUint(ABI_VERSION_V2, 16)
            .storeUint(8, 64)
            .storeUint(0, 256)
            .storeUint(core.getCoreStateHashV2(), 256)
            .storeUint(1, 256)
            .endCell(),
        { bounce: false, value: ton("0.1") },
    );
    expect(encodedMissingDispatch).toHaveFailedTx({ exitCode: ErrorsV2.NotFound });
}

get fun `test v2 IN waits, accepts authenticated input, deduplicates, and consumes`() {
    val deployer = testing.treasury("v2-in-deployer");
    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 0,
        destinationCoreId: 0,
        destinationPort: 2,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var storage = makeV2StorageForNetwork(
        romWithFirstWordV2(0xF029),
        oneRouteV2(route),
        onePeerV2(V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }),
    );
    var initialCore = storage.core.load();
    initialCore.epoch = 1;
    storage.core = initialCore.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(
        core.deploy(deployer.address, SendParams { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: core.address });
    val waiting = sendAdvanceV2ForTest(
        core,
        deployer.address,
        10,
        0,
        0,
        core.getCoreStateHashV2(),
        1,
        1,
        ton("0.1"),
    );
    expect(waiting).toHaveSuccessfulTx<V2Advance>();
    expect(core.getStatusV2()).toEqual(STATUS_WAITING_INPUT_V2);
    expect(core.getInstructionCountV2()).toEqual(0);
    val outputId = v2OutputId(
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
    val first = sendDeliverInputV2ForTest(
        core,
        deployer.address,
        11,
        0,
        outputId,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        7,
        1,
        0,
    );
    expect(first).toHaveSuccessfulTx<V2DeliverInput>();
    expect(first).toEmitExternalMessage<V2InputCommitted>();
    expect(core.getStatusV2()).toEqual(STATUS_RUNNING_V2);
    expect(core.getInboxCountV2()).toEqual(1);
    expect(core.getInputCountV2()).toEqual(1);
    val duplicate = sendDeliverInputV2ForTest(
        core,
        deployer.address,
        12,
        0,
        outputId,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        7,
        1,
        0,
    );
    expect(duplicate).toHaveSuccessfulTx<V2DeliverInput>();
    expect(core.getInputCountV2()).toEqual(1);
    val consume = sendAdvanceV2ForTest(
        core,
        deployer.address,
        13,
        0,
        1,
        core.getCoreStateHashV2(),
        1,
        1,
        ton("0.1"),
    );
    expect(consume).toHaveSuccessfulTx<V2Advance>();
    expect(core.getAccumulatorV2()).toEqual(7);
    expect(core.getInstructionCountV2()).toEqual(1);
    val conflict = sendDeliverInputV2ForTest(
        core,
        deployer.address,
        14,
        0,
        outputId,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        7,
        1,
        1,
    );
    expect(conflict).toHaveFailedTx({
        from: deployer.address,
        to: core.address,
        exitCode: ErrorsV2.ConflictingReplay,
    });
}

get fun `test v2 acknowledgement retires output and rejects wrong peer`() {
    val deployer = testing.treasury("v2-ack-deployer");
    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 0,
        destinationCoreId: 1,
        destinationPort: 0,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var storage = makeV2StorageForNetwork(
        romWithFirstWordV2(0),
        oneRouteV2(route),
        onePeerV2(V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }),
    );
    var coreState = storage.core.load();
    val outputId = v2OutputId(
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        0,
        3,
        1,
    );
    val output = V2OutputRecord {
        domain: DOMAIN_OUTPUT_V2,
        outputId,
        sourceCoreId: 0,
        destinationCoreId: 1,
        sourceEpoch: 0,
        destinationEpoch: 1,
        sourcePort: 0,
        destinationPort: 0,
        sequence: 0,
        value: 3,
        sourceInstructionCount: 1,
        sourceStateHash: 0,
    }.toCell();
    var queues = coreState.queues.load();
    queues.outboxRoot = v2AppendQueueRoot(queues.outboxRoot, output);
    coreState.queues = queues.toCell();
    storage.core = coreState.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(
        core.deploy(deployer.address, SendParams { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: core.address });
    val wrong = sendInputAcceptedV2ForTest(
        core,
        testing.treasury("v2-wrong-ack").address,
        1,
        0,
        outputId,
        1,
        1,
        0,
    );
    expect(wrong).toHaveFailedTx({ exitCode: ErrorsV2.UnauthorizedPeer });
    val accepted = sendInputAcceptedV2ForTest(
        core,
        deployer.address,
        2,
        0,
        outputId,
        1,
        1,
        0,
    );
    expect(accepted).toHaveSuccessfulTx<V2InputAccepted>();
    expect(accepted).toEmitExternalMessage<V2OutputAcknowledged>();
    expect(core.getOutboxCountV2()).toEqual(0);
    val duplicateAccepted = sendInputAcceptedV2ForTest(
        core,
        deployer.address,
        3,
        0,
        outputId,
        1,
        1,
        0,
    );
    expect(duplicateAccepted).toHaveSuccessfulTx<V2InputAccepted>();
    expect(core.getOutboxCountV2()).toEqual(0);

    var pressuredStorage = makeV2StorageForNetwork(
        romWithFirstWordV2(0),
        oneRouteV2(route),
        onePeerV2(V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }),
    );
    var pressuredCore = pressuredStorage.core.load();
    pressuredCore.status = STATUS_BACKPRESSURED_V2;
    var pressuredQueues = pressuredCore.queues.load();
    pressuredQueues.outboxRoot = v2AppendQueueRoot(pressuredQueues.outboxRoot, output);
    pressuredCore.queues = pressuredQueues.toCell();
    pressuredStorage.core = pressuredCore.toCell();
    val pressured = TonolithCoreV2.fromStorage(pressuredStorage);
    expect(pressured.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: pressured.address,
    });
    expect(
        sendInputAcceptedV2ForTest(
            pressured,
            deployer.address,
            4,
            0,
            outputId,
            1,
            1,
            0,
        ),
    ).toHaveSuccessfulTx<V2InputAccepted>();
    expect(pressured.getStatusV2()).toEqual(STATUS_RUNNING_V2);
}

get fun `test v2 inherited opcode families execute through the contract`() {
    val deployer = testing.treasury("v2-opcode-deployer");
    val nop = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x0000)));
    expect(
        nop.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nop.address });
    expect(advanceV2OnceForTest(nop, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val ldi = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x100F)));
    expect(
        ldi.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: ldi.address });
    expect(advanceV2OnceForTest(ldi, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val ldr = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x2000)));
    expect(
        ldr.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: ldr.address });
    expect(advanceV2OnceForTest(ldr, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val str = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x3000)));
    expect(
        str.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: str.address });
    expect(advanceV2OnceForTest(str, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val add = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x4000)));
    expect(
        add.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: add.address });
    expect(advanceV2OnceForTest(add, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val adc = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x5000)));
    expect(
        adc.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: adc.address });
    expect(advanceV2OnceForTest(adc, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val sub = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x6000)));
    expect(
        sub.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: sub.address });
    expect(advanceV2OnceForTest(sub, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val andCpu = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x7000)));
    expect(
        andCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: andCpu.address });
    expect(advanceV2OnceForTest(andCpu, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val orCpu = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x8000)));
    expect(
        orCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: orCpu.address });
    expect(advanceV2OnceForTest(orCpu, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val xorCpu = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x9000)));
    expect(
        xorCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: xorCpu.address });
    expect(advanceV2OnceForTest(xorCpu, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val ldm = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xA000)));
    expect(
        ldm.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: ldm.address });
    expect(advanceV2OnceForTest(ldm, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val stm = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xB000)));
    expect(
        stm.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: stm.address });
    expect(advanceV2OnceForTest(stm, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val jmp = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xC000)));
    expect(
        jmp.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: jmp.address });
    expect(advanceV2OnceForTest(jmp, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val jz = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xD000)));
    expect(
        jz.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: jz.address });
    expect(advanceV2OnceForTest(jz, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val jc = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xE000)));
    expect(
        jc.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: jc.address });
    expect(advanceV2OnceForTest(jc, deployer.address)).toHaveSuccessfulTx<V2Advance>();
}

get fun `test v2 SYS controls cover flags shifts arithmetic and architectural stops`() {
    val deployer = testing.treasury("v2-sys-deployer");
    val clc = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF002)));
    expect(
        clc.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: clc.address });
    expect(advanceV2OnceForTest(clc, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val stc = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF003)));
    expect(
        stc.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: stc.address });
    expect(advanceV2OnceForTest(stc, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val notCpu = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF004)));
    expect(
        notCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: notCpu.address });
    expect(advanceV2OnceForTest(notCpu, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val shl = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF005)));
    expect(
        shl.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: shl.address });
    expect(advanceV2OnceForTest(shl, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val shr = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF006)));
    expect(
        shr.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: shr.address });
    expect(advanceV2OnceForTest(shr, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val inc = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF007)));
    expect(
        inc.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: inc.address });
    expect(advanceV2OnceForTest(inc, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val dec = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF008)));
    expect(
        dec.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: dec.address });
    expect(advanceV2OnceForTest(dec, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    val out = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF001)));
    expect(
        out.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: out.address });
    val outResult = advanceV2OnceForTest(out, deployer.address);
    expect(outResult).toHaveSuccessfulTx<V2Advance>();
    expect(outResult).toEmitExternalMessage<V2BatchAdvanced>();
    val yield = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF00B)));
    expect(
        yield.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: yield.address });
    expect(advanceV2OnceForTest(yield, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(yield.getEpochV2()).toEqual(1);
    val trap = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF1AC)));
    expect(
        trap.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: trap.address });
    expect(advanceV2OnceForTest(trap, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(trap.getStatusV2()).toEqual(STATUS_FAULTED_V2);
}

get fun `test v2 bounded memory ROM queues routes peers and commitments`() {
    val route0 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 0,
        destinationCoreId: 1,
        destinationPort: 0,
        delay: 1,
        maxRecordsPerEpoch: 4,
    }.toCell();
    val route1 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 1,
        destinationCoreId: 2,
        destinationPort: 1,
        delay: 2,
        maxRecordsPerEpoch: 4,
    }.toCell();
    val route2 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 2,
        sourcePort: 2,
        destinationCoreId: 3,
        destinationPort: 2,
        delay: 3,
        maxRecordsPerEpoch: 4,
    }.toCell();
    val route3 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 3,
        sourcePort: 3,
        destinationCoreId: 4,
        destinationPort: 3,
        delay: 4,
        maxRecordsPerEpoch: 4,
    }.toCell();
    var routes = emptyV2RecordRoot();
    routes = v2AppendQueueRoot(routes, route0);
    routes = v2AppendQueueRoot(routes, route1);
    routes = v2AppendQueueRoot(routes, route2);
    routes = v2AppendQueueRoot(routes, route3);
    expect(v2QueueCount(routes)).toEqual(4);
    expect((v2RecordAt(routes, 0) as Cell<V2Route>).load().sourcePort).toEqual(0);
    expect((v2RecordAt(routes, 3) as Cell<V2Route>).load().destinationCoreId).toEqual(4);
    val replaced = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 9,
        sourcePort: 9,
        destinationCoreId: 10,
        destinationPort: 9,
        delay: 1,
        maxRecordsPerEpoch: 4,
    }.toCell();
    val replacedRoutes = v2ReplaceRecordAt(routes, 2, replaced);
    expect((v2RecordAt(replacedRoutes, 2) as Cell<V2Route>).load().sourceCoreId).toEqual(9);
    val removedRoutes = v2RemoveRecordAt(replacedRoutes, 1);
    expect(v2QueueCount(removedRoutes)).toEqual(3);
    var fullRoutes = emptyV2RecordRoot();
    repeat (16) {
        fullRoutes = v2AppendQueueRoot(fullRoutes, route0);
    }
    expect(v2QueueCount(fullRoutes)).toEqual(16);
    expect((v2RecordAt(fullRoutes, 4) as Cell<V2Route>).load().sourcePort).toEqual(0);
    expect((v2RecordAt(fullRoutes, 8) as Cell<V2Route>).load().sourcePort).toEqual(0);
    expect((v2RecordAt(fullRoutes, 12) as Cell<V2Route>).load().sourcePort).toEqual(0);
    expect(v2QueueCount(v2RemoveRecordAt(fullRoutes, 4))).toEqual(15);
    expect(v2QueueCount(v2RemoveRecordAt(fullRoutes, 8))).toEqual(15);
    expect(v2QueueCount(v2RemoveRecordAt(fullRoutes, 12))).toEqual(15);
    val peer0 = V2Peer {
        domain: DOMAIN_PEER_V2,
        coreId: 7,
        peerAddress: testing.treasury("v2-peer-address").address,
    }.toCell();
    var peers = emptyV2RecordRoot();
    peers = v2AppendQueueRoot(peers, peer0);
    expect(v2FindPeer(peers, 7)!.coreId).toEqual(7);
    expect(v2FindPeer(peers, 8)).toEqual(null);
    val input = V2InputRecord {
        domain: DOMAIN_INPUT_V2,
        outputId: 1,
        sourceCoreId: 1,
        destinationCoreId: 0,
        sourceEpoch: 0,
        destinationEpoch: 1,
        sourcePort: 0,
        destinationPort: 2,
        sequence: 0,
        value: 9,
        sourceInstructionCount: 1,
        sourceStateHash: 2,
        consumed: 0,
    }.toCell();
    var inputs = emptyV2RecordRoot();
    inputs = v2AppendQueueRoot(inputs, input);
    expect(v2FindInput(inputs, 1, 2)!.value).toEqual(9);
    expect(v2FindInputSlot(inputs, 1, 2, 0).found).toEqual(1);
    expect(v2FindRecordById(inputs, 1).found).toEqual(1);

    var orderedInputs = emptyV2RecordRoot();
    orderedInputs = v2InsertInputRecord(
        orderedInputs,
        inputRecordV2ForTest(1, 2, 0, 10),
    );
    orderedInputs = v2InsertInputRecord(
        orderedInputs,
        inputRecordV2ForTest(1, 2, 2, 12),
    );
    orderedInputs = v2InsertInputRecord(
        orderedInputs,
        inputRecordV2ForTest(1, 2, 1, 11),
    );
    orderedInputs = v2InsertInputRecord(
        orderedInputs,
        inputRecordV2ForTest(0, 9, 0, 9),
    );
    orderedInputs = v2InsertInputRecord(
        orderedInputs,
        inputRecordV2ForTest(1, 1, 0, 8),
    );
    expect(v2InputAt(orderedInputs, 0).outputId).toEqual(9);
    expect(v2InputAt(orderedInputs, 1).outputId).toEqual(8);
    expect(v2InputAt(orderedInputs, 2).outputId).toEqual(10);
    expect(v2InputAt(orderedInputs, 3).outputId).toEqual(11);
    expect(v2InputAt(orderedInputs, 4).outputId).toEqual(12);

    var onePage = emptyV2RecordRoot();
    onePage = v2AppendQueueRoot(onePage, route0);
    expect(v2QueueCount(v2ReplaceRecordAt(onePage, 0, route0))).toEqual(1);
    val twoPage = v2AppendQueueRoot(onePage, route0);
    expect(v2QueueCount(v2ReplaceRecordAt(twoPage, 1, route0))).toEqual(2);
    val threePage = v2AppendQueueRoot(twoPage, route0);
    expect(v2QueueCount(v2ReplaceRecordAt(threePage, 2, route0))).toEqual(3);
    val consumed = V2InputRecord {
        domain: DOMAIN_INPUT_V2,
        outputId: 1,
        sourceCoreId: 1,
        destinationCoreId: 0,
        sourceEpoch: 0,
        destinationEpoch: 1,
        sourcePort: 0,
        destinationPort: 2,
        sequence: 0,
        value: 9,
        sourceInstructionCount: 1,
        sourceStateHash: 2,
        consumed: 1,
    }.toCell();
    expect(v2InputAt(v2ReplaceRecordAt(inputs, 0, consumed), 0).consumed).toEqual(1);
    expect(v2FindInput(inputs, 9, 9).found).toEqual(0);
    expect(v2FindInputSlot(inputs, 9, 9, 9).found).toEqual(0);
    expect(v2FindRecordById(inputs, 99).found).toEqual(0);
    val rom = romWithFirstWordV2(0xABCD);
    var memCore = makeV2StorageForTest(rom).core.load();
    writeV2Ram(mutate memCore, 0, 1);
    writeV2Ram(mutate memCore, 64, 2);
    writeV2Ram(mutate memCore, 128, 3);
    writeV2Ram(mutate memCore, 192, 4);
    expect(readV2Ram(memCore, 0)).toEqual(1);
    expect(readV2Ram(memCore, 64)).toEqual(2);
    expect(readV2Ram(memCore, 128)).toEqual(3);
    expect(readV2Ram(memCore, 192)).toEqual(4);
    expect(v2RomWord(rom, 0)).toEqual(0xABCD);
    expect(v2RomWord(rom, 16)).toEqual(0);
    expect(v2RomWord(rom, 32)).toEqual(0);
    expect(v2RomWord(rom, 128)).toEqual(0);
    expect(v2RomWord(rom, 256)).toEqual(0);
    expect(v2RomWord(rom, 512)).toEqual(0);
    expect(v2RomWord(rom, 1023)).toEqual(0);
    expect(
        v2StaticCommitment(
            1,
            0,
            2,
            rom.hash(),
            routes.hash(),
            peers.hash(),
            3,
        ),
    ).toNotEqual(0);
    expect(nextV2LegacyOutputCommitment(0, 1, 2, 3)).toNotEqual(0);
    expect(nextV2AcknowledgementCommitment(0, 1)).toNotEqual(0);
    expect(nextV2OutputCommitment(0, 1, 2, 3)).toNotEqual(0);
    expect(
        nextV2InputCommitment(
            0,
            1,
            2,
            3,
            4,
            0,
        ),
    ).toNotEqual(0);
    expect(nextV2EpochCommitment(0, 1, 2, 3, 4)).toNotEqual(0);
    expect(nextV2TraceCommitment(0, 1, 2)).toNotEqual(0);
    expect(
        nextV2BatchCommitment(
            1,
            2,
            0,
            1,
            1,
            0,
            STOP_REQUEST_LIMIT_V2,
            3,
        ),
    ).toNotEqual(0);
}

get fun `test v2 bounded structures cover every fixed slot and selector`() {
    expect(v2StopReason(STATUS_HALTED_V2, false)).toEqual(STOP_HALTED_V2);
    expect(v2StopReason(STATUS_FAULTED_V2, false)).toEqual(STOP_FAULTED_V2);
    expect(v2StopReason(STATUS_WAITING_INPUT_V2, false)).toEqual(STOP_INPUT_UNAVAILABLE_V2);
    expect(v2StopReason(STATUS_BACKPRESSURED_V2, false)).toEqual(STOP_OUTPUT_BACKPRESSURE_V2);
    expect(v2StopReason(STATUS_RUNNING_V2, true)).toEqual(STOP_YIELDED_V2);
    expect(v2StopReason(STATUS_RUNNING_V2, false)).toEqual(STOP_REQUEST_LIMIT_V2);

    val route0 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 0,
        destinationCoreId: 1,
        destinationPort: 0,
        delay: 1,
        maxRecordsPerEpoch: 4,
    }.toCell();
    val invalidRoute = V2Route {
        domain: 0,
        sourceCoreId: 0,
        sourcePort: 0,
        destinationCoreId: 99,
        destinationPort: 15,
        delay: 1,
        maxRecordsPerEpoch: 4,
    }.toCell();
    var routes = emptyV2RecordRoot();
    routes = v2AppendQueueRoot(routes, invalidRoute);
    routes = v2AppendQueueRoot(routes, route0);
    expect(v2FindRoute(routes, 0, 0)!.destinationCoreId).toEqual(1);
    expect(v2FindRoute(routes, 7, 7)).toEqual(null);

    val validPeer = V2Peer {
        domain: DOMAIN_PEER_V2,
        coreId: 7,
        peerAddress: testing.treasury("v2-selector-peer").address,
    }.toCell();
    val invalidPeer = V2Peer {
        domain: 0,
        coreId: 7,
        peerAddress: testing.treasury("v2-selector-invalid-peer").address,
    }.toCell();
    var peers = emptyV2RecordRoot();
    peers = v2AppendQueueRoot(peers, invalidPeer);
    peers = v2AppendQueueRoot(peers, validPeer);
    expect(v2FindPeer(peers, 7)!.coreId).toEqual(7);

    var fullRoutes = emptyV2RecordRoot();
    repeat (16) {
        fullRoutes = v2AppendQueueRoot(fullRoutes, route0);
    }
    expect(v2RecordAt(fullRoutes, 0).hash()).toEqual(v2RecordAt(fullRoutes, 0).hash());
    expect(v2RecordAt(fullRoutes, 1).hash()).toEqual(v2RecordAt(fullRoutes, 1).hash());
    expect(v2RecordAt(fullRoutes, 2).hash()).toEqual(v2RecordAt(fullRoutes, 2).hash());
    expect(v2RecordAt(fullRoutes, 3).hash()).toEqual(v2RecordAt(fullRoutes, 3).hash());
    expect(v2RecordAt(fullRoutes, 4).hash()).toEqual(v2RecordAt(fullRoutes, 4).hash());
    expect(v2RecordAt(fullRoutes, 5).hash()).toEqual(v2RecordAt(fullRoutes, 5).hash());
    expect(v2RecordAt(fullRoutes, 6).hash()).toEqual(v2RecordAt(fullRoutes, 6).hash());
    expect(v2RecordAt(fullRoutes, 7).hash()).toEqual(v2RecordAt(fullRoutes, 7).hash());
    expect(v2RecordAt(fullRoutes, 8).hash()).toEqual(v2RecordAt(fullRoutes, 8).hash());
    expect(v2RecordAt(fullRoutes, 9).hash()).toEqual(v2RecordAt(fullRoutes, 9).hash());
    expect(v2RecordAt(fullRoutes, 10).hash()).toEqual(v2RecordAt(fullRoutes, 10).hash());
    expect(v2RecordAt(fullRoutes, 11).hash()).toEqual(v2RecordAt(fullRoutes, 11).hash());
    expect(v2RecordAt(fullRoutes, 12).hash()).toEqual(v2RecordAt(fullRoutes, 12).hash());
    expect(v2RecordAt(fullRoutes, 13).hash()).toEqual(v2RecordAt(fullRoutes, 13).hash());
    expect(v2RecordAt(fullRoutes, 14).hash()).toEqual(v2RecordAt(fullRoutes, 14).hash());
    expect(v2RecordAt(fullRoutes, 15).hash()).toEqual(v2RecordAt(fullRoutes, 15).hash());
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 0, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 1, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 2, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 3, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 4, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 5, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 6, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 7, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 8, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 9, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 10, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 11, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 12, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 13, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 14, route0))).toEqual(16);
    expect(v2QueueCount(v2ReplaceRecordAt(fullRoutes, 15, route0))).toEqual(16);

    var memCore = makeV2StorageForTest(zeroV2RomRoot()).core.load();
    writeV2Register(mutate memCore, 0, 1);
    writeV2Register(mutate memCore, 15, 15);
    expect(readV2Register(memCore, 0)).toEqual(1);
    expect(readV2Register(memCore, 15)).toEqual(15);
    writeV2Ram(mutate memCore, 63, 5);
    writeV2Ram(mutate memCore, 127, 6);
    writeV2Ram(mutate memCore, 191, 7);
    writeV2Ram(mutate memCore, 255, 8);
    expect(readV2Ram(memCore, 63)).toEqual(5);
    expect(readV2Ram(memCore, 127)).toEqual(6);
    expect(readV2Ram(memCore, 191)).toEqual(7);
    expect(readV2Ram(memCore, 255)).toEqual(8);

    val rom = romWithFirstWordV2(0xABCD);
    val romRoot = rom.load();
    val level2 = romRoot.level20.load();
    expect(selectV2RomLevel1(level2, 0).leaf0.load().firstHalf).toEqual(0xABCD as uint256 << 240);
    expect(selectV2RomLevel1(level2, 1).leaf0.load().firstHalf).toEqual(0);
    expect(selectV2RomLevel1(level2, 2).leaf0.load().firstHalf).toEqual(0);
    expect(selectV2RomLevel1(level2, 3).leaf0.load().firstHalf).toEqual(0);
    expect(v2RomWord(rom, 15)).toEqual(0);
    expect(v2RomWord(rom, 16)).toEqual(0);
    expect(v2RomWord(rom, 31)).toEqual(0);
    expect(v2RomWord(rom, 64)).toEqual(0);
    expect(v2RomWord(rom, 192)).toEqual(0);
    expect(v2RomWord(rom, 320)).toEqual(0);
    expect(v2RomWord(rom, 448)).toEqual(0);
    expect(v2RomWord(rom, 640)).toEqual(0);
    expect(v2RomWord(rom, 768)).toEqual(0);
    expect(v2RomWord(rom, 896)).toEqual(0);
    expect(v2RomWord(rom, 1023)).toEqual(0);
}

get fun `test v2 execution edge paths preserve bounded progress`() {
    val deployer = testing.treasury("v2-execution-edge-paths");

    var waitingStorage = makeV2StorageForTest(romWithFirstWordV2(0));
    var waitingCore = waitingStorage.core.load();
    waitingCore.status = STATUS_WAITING_INPUT_V2;
    waitingStorage.core = waitingCore.toCell();
    val waiting = TonolithCoreV2.fromStorage(waitingStorage);
    expect(waiting.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: waiting.address,
    });
    expect(advanceV2OnceForTest(waiting, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(waiting.getStatusV2()).toEqual(STATUS_RUNNING_V2);

    var backpressureStorage = makeV2StorageForTest(romWithFirstWordV2(0));
    var backpressureCore = backpressureStorage.core.load();
    backpressureCore.status = STATUS_BACKPRESSURED_V2;
    backpressureStorage.core = backpressureCore.toCell();
    val backpressure = TonolithCoreV2.fromStorage(backpressureStorage);
    expect(
        backpressure.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: backpressure.address });
    expect(
        advanceV2OnceForTest(backpressure, deployer.address),
    ).toHaveSuccessfulTx<V2Advance>();
    expect(backpressure.getStatusV2()).toEqual(STATUS_RUNNING_V2);

    var jzStorage = makeV2StorageForTest(romWithFirstWordV2(0xD123));
    var jzCore = jzStorage.core.load();
    jzCore.flags = FLAG_ZERO_V2;
    jzStorage.core = jzCore.toCell();
    val jzTakenWithFlag = TonolithCoreV2.fromStorage(jzStorage);
    expect(
        jzTakenWithFlag.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: jzTakenWithFlag.address });
    expect(
        advanceV2OnceForTest(jzTakenWithFlag, deployer.address),
    ).toHaveSuccessfulTx<V2Advance>();
    expect(jzTakenWithFlag.getPcV2()).toEqual(0x123);

    val jzNotTaken = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xD123)));
    expect(jzNotTaken.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: jzNotTaken.address,
    });
    expect(advanceV2OnceForTest(jzNotTaken, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(jzNotTaken.getPcV2()).toEqual(1);

    var jcStorage = makeV2StorageForTest(romWithFirstWordV2(0xE123));
    var jcCore = jcStorage.core.load();
    jcCore.flags = FLAG_CARRY_V2;
    jcStorage.core = jcCore.toCell();
    val jcTaken = TonolithCoreV2.fromStorage(jcStorage);
    expect(jcTaken.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: jcTaken.address,
    });
    expect(advanceV2OnceForTest(jcTaken, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(jcTaken.getPcV2()).toEqual(0x123);

    var adcStorage = makeV2StorageForTest(romWithFirstWordV2(0x5000));
    var adcCore = adcStorage.core.load();
    adcCore.flags = FLAG_CARRY_V2;
    adcStorage.core = adcCore.toCell();
    val adc = TonolithCoreV2.fromStorage(adcStorage);
    expect(adc.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: adc.address,
    });
    expect(advanceV2OnceForTest(adc, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(adc.getAccumulatorV2()).toEqual(1);

    val invalidNop = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x0001)));
    expect(invalidNop.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidNop.address,
    });
    expect(advanceV2OnceForTest(invalidNop, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });
    val invalidLdi = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0x10FF)));
    expect(invalidLdi.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidLdi.address,
    });
    expect(advanceV2OnceForTest(invalidLdi, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });
    val invalidRegister = TonolithCoreV2.fromStorage(
        makeV2StorageForTest(romWithFirstWordV2(0x2FF)),
    );
    expect(invalidRegister.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidRegister.address,
    });
    expect(advanceV2OnceForTest(invalidRegister, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });
    val invalidRam = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xA100)));
    expect(invalidRam.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidRam.address,
    });
    expect(advanceV2OnceForTest(invalidRam, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });
    val invalidJump = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xC400)));
    expect(invalidJump.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidJump.address,
    });
    expect(advanceV2OnceForTest(invalidJump, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });
    val invalidSys = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0xF00D)));
    expect(invalidSys.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidSys.address,
    });
    expect(advanceV2OnceForTest(invalidSys, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidInstruction,
    });

    val missingRoute = TonolithCoreV2.fromStorage(
        makeV2StorageForNetwork(
            romWithFirstWordV2(0xF03A),
            emptyV2RecordRoot(),
            onePeerV2(V2Peer {
                domain: DOMAIN_PEER_V2,
                coreId: 1,
                peerAddress: deployer.address,
            }),
        ),
    );
    expect(missingRoute.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: missingRoute.address,
    });
    expect(advanceV2OnceForTest(missingRoute, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidRoute,
    });

    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 3,
        destinationCoreId: 1,
        destinationPort: 4,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var sequenceStorage = makeV2StorageForNetwork(
        romWithFirstWordV2(0xF03A),
        oneRouteV2(route),
        onePeerV2(V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }),
    );
    var sequenceCore = sequenceStorage.core.load();
    sequenceCore.nextOutputSequence = (255 as uint128) << 24;
    sequenceStorage.core = sequenceCore.toCell();
    val sequenceLimit = TonolithCoreV2.fromStorage(sequenceStorage);
    expect(sequenceLimit.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: sequenceLimit.address,
    });
    expect(advanceV2OnceForTest(sequenceLimit, deployer.address)).toHaveFailedTx({
        exitCode: ErrorsV2.InvalidSequence,
    });

    var fullOutboxStorage = makeV2StorageForTest(romWithFirstWordV2(0xF03A));
    var fullOutboxCore = fullOutboxStorage.core.load();
    var fullOutboxQueues = fullOutboxCore.queues.load();
    repeat (16) {
        fullOutboxQueues.outboxRoot = v2AppendQueueRoot(
            fullOutboxQueues.outboxRoot,
            outputRecordV2ForTest(0),
        );
    }
    fullOutboxCore.queues = fullOutboxQueues.toCell();
    fullOutboxCore.pc = 0;
    fullOutboxCore.instructionCount = 0;
    fullOutboxStorage.core = fullOutboxCore.toCell();
    var directFullOutboxCore = fullOutboxCore;
    v2ExecuteSys(
        mutate directFullOutboxCore,
        0x3A,
        0,
        0,
        emptyV2RecordRoot(),
        0,
    );
    expect(directFullOutboxCore.status).toEqual(STATUS_BACKPRESSURED_V2);
    val fullOutbox = TonolithCoreV2.fromStorage(fullOutboxStorage);
    expect(fullOutbox.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: fullOutbox.address,
    });
    expect(fullOutbox.getOutboxCountV2()).toEqual(16);
    expect(advanceV2OnceForTest(fullOutbox, deployer.address)).toHaveSuccessfulTx<V2Advance>();
    expect(fullOutbox.getStatusV2()).toEqual(STATUS_BACKPRESSURED_V2);
    expect(fullOutbox.getPcV2()).toEqual(0);
    expect(fullOutbox.getInstructionCountV2()).toEqual(0);
    expect(fullOutbox.getOutboxCountV2()).toEqual(16);
}

get fun `test v2 advance validation and storage guards`() {
    val deployer = testing.treasury("v2-advance-validation");
    val core = TonolithCoreV2.fromStorage(makeV2StorageForTest(romWithFirstWordV2(0)));
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    val initialHash = core.getCoreStateHashV2();

    val invalidAbi = core.sendV2Advance(
        deployer.address,
        1,
        0,
        0,
        0,
        initialHash,
        1,
        1,
        { value: ton("0.1") },
    );
    expect(invalidAbi).toHaveFailedTx({ exitCode: ErrorsV2.InvalidVersion });
    val zeroSteps = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        2,
        0,
        0,
        initialHash,
        0,
        1,
        { value: ton("0.1") },
    );
    expect(zeroSteps).toHaveFailedTx({ exitCode: ErrorsV2.InvalidBody });
    val tooManySteps = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        3,
        0,
        0,
        initialHash,
        2,
        1,
        { value: ton("0.1") },
    );
    expect(tooManySteps).toHaveFailedTx({ exitCode: ErrorsV2.InvalidBody });
    val zeroOutputs = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        4,
        0,
        0,
        initialHash,
        1,
        0,
        { value: ton("0.1") },
    );
    expect(zeroOutputs).toHaveFailedTx({ exitCode: ErrorsV2.InvalidBody });
    val tooManyOutputs = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        5,
        0,
        0,
        initialHash,
        1,
        17,
        { value: ton("0.1") },
    );
    expect(tooManyOutputs).toHaveFailedTx({ exitCode: ErrorsV2.InvalidBody });
    val insufficient = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        6,
        0,
        0,
        initialHash,
        1,
        1,
        { value: ton("0.001") },
    );
    expect(insufficient).toHaveFailedTx({ exitCode: ErrorsV2.InsufficientValue });
    val invalidRun = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        7,
        1,
        0,
        initialHash,
        1,
        1,
        { value: ton("0.1") },
    );
    expect(invalidRun).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRun });
    val stale = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        8,
        0,
        1,
        initialHash,
        1,
        1,
        { value: ton("0.1") },
    );
    expect(stale).toHaveFailedTx({ exitCode: ErrorsV2.StaleAdvance });
    val wrongHash = core.sendV2Advance(
        deployer.address,
        ABI_VERSION_V2,
        9,
        0,
        0,
        1,
        1,
        1,
        { value: ton("0.1") },
    );
    expect(wrongHash).toHaveFailedTx({ exitCode: ErrorsV2.StateHashMismatch });

    var invalidMagicStorage = makeV2StorageForTest(zeroV2RomRoot());
    invalidMagicStorage.magic = 0;
    val invalidMagic = TonolithCoreV2.fromStorage(invalidMagicStorage);
    expect(invalidMagic.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidMagic.address,
    });
    expect(
        invalidMagic.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            10,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });

    var invalidSchemaStorage = makeV2StorageForTest(zeroV2RomRoot());
    invalidSchemaStorage.schemaVersion = 1;
    val invalidSchema = TonolithCoreV2.fromStorage(invalidSchemaStorage);
    expect(invalidSchema.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidSchema.address,
    });
    expect(
        invalidSchema.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            11,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });

    var invalidIsaStorage = makeV2StorageForTest(zeroV2RomRoot());
    invalidIsaStorage.isaVersion = 1;
    val invalidIsa = TonolithCoreV2.fromStorage(invalidIsaStorage);
    expect(invalidIsa.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidIsa.address,
    });
    expect(
        invalidIsa.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            12,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });

    var invalidAbiStorage = makeV2StorageForTest(zeroV2RomRoot());
    invalidAbiStorage.abiVersion = 1;
    val invalidAbiStorageCore = TonolithCoreV2.fromStorage(invalidAbiStorage);
    expect(
        invalidAbiStorageCore.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: invalidAbiStorageCore.address });
    expect(
        invalidAbiStorageCore.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            13,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });

    var invalidProtocolStorage = makeV2StorageForTest(zeroV2RomRoot());
    invalidProtocolStorage.protocolVersion = 1;
    val invalidProtocol = TonolithCoreV2.fromStorage(invalidProtocolStorage);
    expect(invalidProtocol.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidProtocol.address,
    });
    expect(
        invalidProtocol.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            14,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });

    var invalidDomainStorage = makeV2StorageForTest(zeroV2RomRoot());
    var invalidDomainCore = invalidDomainStorage.core.load();
    invalidDomainCore.domain = 0;
    invalidDomainStorage.core = invalidDomainCore.toCell();
    val invalidDomain = TonolithCoreV2.fromStorage(invalidDomainStorage);
    expect(invalidDomain.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidDomain.address,
    });
    expect(
        invalidDomain.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            15,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStorage });

    var invalidCommitmentStorage = makeV2StorageForTest(zeroV2RomRoot());
    var invalidCommitmentCore = invalidCommitmentStorage.core.load();
    invalidCommitmentCore.staticCommitment = 1;
    invalidCommitmentStorage.core = invalidCommitmentCore.toCell();
    val invalidCommitment = TonolithCoreV2.fromStorage(invalidCommitmentStorage);
    expect(
        invalidCommitment.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: invalidCommitment.address });
    expect(
        invalidCommitment.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            16,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStaticCommitment });

    var invalidStatusStorage = makeV2StorageForTest(zeroV2RomRoot());
    var invalidStatusCore = invalidStatusStorage.core.load();
    invalidStatusCore.status = STATUS_FAULTED_V2;
    invalidStatusStorage.core = invalidStatusCore.toCell();
    val invalidStatus = TonolithCoreV2.fromStorage(invalidStatusStorage);
    expect(invalidStatus.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidStatus.address,
    });
    expect(
        invalidStatus.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            17,
            0,
            0,
            0,
            1,
            1,
            { value: ton("0.1") },
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidStatus });
}

get fun `test v2 receiver selectors topup and external rejection`() {
    val deployer = testing.treasury("v2-receiver-selectors");
    val core = TonolithCoreV2.fromStorage(makeV2StorageForTest(zeroV2RomRoot()));
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    expect(
        core.sendAny(deployer.address, createEmptyCell(), { value: ton("0.1") }),
    ).toHaveSuccessfulTx();
    val short = core.sendAny(
        deployer.address,
        beginCell().storeUint(1, 8).endCell(),
        { value: ton("0.1") },
    );
    expect(short).toHaveFailedTx({ exitCode: ErrorsV2.InvalidBody });
    val unknown = core.sendAny(
        deployer.address,
        beginCell().storeUint(0x99999999, 32).endCell(),
        { value: ton("0.1") },
    );
    expect(unknown).toHaveFailedTx({ exitCode: ErrorsV2.UnknownMessage });
    val topup = core.sendV2TopUp(
        deployer.address,
        ABI_VERSION_V2,
        1,
        0,
        { value: ton("0.1") },
    );
    expect(topup).toHaveSuccessfulTx<V2TopUp>();
    val invalidTopupVersion = core.sendV2TopUp(
        deployer.address,
        1,
        2,
        0,
        { value: ton("0.1") },
    );
    expect(invalidTopupVersion).toHaveFailedTx({ exitCode: ErrorsV2.InvalidVersion });
    val invalidTopupRun = core.sendV2TopUp(
        deployer.address,
        ABI_VERSION_V2,
        3,
        1,
        { value: ton("0.1") },
    );
    expect(invalidTopupRun).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRun });
    expect(core.sendAnyExternal(createEmptyCell())).toBeNull();
}

get fun `test v2 inbox insertion is canonical under out of order delivery`() {
    val deployer = testing.treasury("v2-inbox-order");
    val route = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 0,
        destinationCoreId: 0,
        destinationPort: 2,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var storage = makeV2StorageForNetwork(
        romWithFirstWordV2(0xF029),
        oneRouteV2(route),
        onePeerV2(V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }),
    );
    var initialCore = storage.core.load();
    initialCore.epoch = 1;
    initialCore.status = STATUS_WAITING_INPUT_V2;
    storage.core = initialCore.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    val sequenceOne = v2OutputId(
        0,
        1,
        0,
        0,
        1,
        0,
        2,
        1,
        8,
        1,
    );
    val sequenceZero = v2OutputId(
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
        sendDeliverInputV2ForTest(
            core,
            deployer.address,
            1,
            0,
            sequenceOne,
            1,
            0,
            0,
            1,
            0,
            2,
            1,
            8,
            1,
            0,
        ),
    ).toHaveSuccessfulTx<V2DeliverInput>();
    expect(
        sendDeliverInputV2ForTest(
            core,
            deployer.address,
            2,
            0,
            sequenceZero,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveSuccessfulTx<V2DeliverInput>();
    expect(core.getInboxCountV2()).toEqual(2);
    expect(
        advanceV2OnceForTest(core, deployer.address),
    ).toHaveSuccessfulTx<V2Advance>();
    expect(core.getAccumulatorV2()).toEqual(7);
}

get fun `test v2 delivery validation rejects malformed routes epochs and replays`() {
    val deployer = testing.treasury("v2-delivery-validation");
    val route0 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 0,
        destinationCoreId: 0,
        destinationPort: 2,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    val route1 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 1,
        destinationCoreId: 0,
        destinationPort: 3,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    val route2 = V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 1,
        sourcePort: 2,
        destinationCoreId: 2,
        destinationPort: 4,
        delay: 1,
        maxRecordsPerEpoch: 4,
    };
    var routes = emptyV2RecordRoot();
    routes = v2AppendQueueRoot(routes, route0.toCell());
    routes = v2AppendQueueRoot(routes, route1.toCell());
    routes = v2AppendQueueRoot(routes, route2.toCell());
    var storage = makeV2StorageForNetwork(
        romWithFirstWordV2(0xF029),
        routes,
        onePeerV2(V2Peer {
            domain: DOMAIN_PEER_V2,
            coreId: 1,
            peerAddress: deployer.address,
        }),
    );
    var initialCore = storage.core.load();
    initialCore.epoch = 1;
    initialCore.status = STATUS_WAITING_INPUT_V2;
    storage.core = initialCore.toCell();
    val core = TonolithCoreV2.fromStorage(storage);
    expect(core.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: core.address,
    });
    val validOutputId = v2OutputId(
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
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            1,
            ton("0.1"),
            1,
            0,
            validOutputId,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidVersion });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.001"),
            2,
            0,
            validOutputId,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InsufficientValue });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            3,
            1,
            validOutputId,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRun });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            4,
            0,
            validOutputId,
            1,
            1,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.UnauthorizedPeer });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            5,
            0,
            validOutputId,
            2,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.UnauthorizedPeer });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            testing.treasury("v2-delivery-wrong-sender").address,
            ABI_VERSION_V2,
            ton("0.1"),
            6,
            0,
            validOutputId,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.UnauthorizedPeer });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            7,
            0,
            validOutputId,
            1,
            0,
            0,
            1,
            3,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRoute });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            8,
            0,
            validOutputId,
            1,
            0,
            0,
            1,
            2,
            0,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRoute });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            9,
            0,
            validOutputId,
            1,
            0,
            0,
            0,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidEpoch });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            10,
            0,
            validOutputId,
            1,
            0,
            0,
            1,
            0,
            2,
            4,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidSequence });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            11,
            0,
            validOutputId,
            1,
            0,
            2,
            3,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidEpoch });
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            12,
            0,
            1,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            7,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.InvalidRoute });
    val first = sendDeliverInputV2WithConfig(
        core,
        deployer.address,
        ABI_VERSION_V2,
        ton("0.1"),
        13,
        0,
        validOutputId,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        7,
        1,
        0,
    );
    expect(first).toHaveSuccessfulTx<V2DeliverInput>();
    val conflictingOutputId = v2OutputId(
        0,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        8,
        1,
    );
    expect(
        sendDeliverInputV2WithConfig(
            core,
            deployer.address,
            ABI_VERSION_V2,
            ton("0.1"),
            14,
            0,
            conflictingOutputId,
            1,
            0,
            0,
            1,
            0,
            2,
            0,
            8,
            1,
            0,
        ),
    ).toHaveFailedTx({ exitCode: ErrorsV2.ConflictingReplay });
}
