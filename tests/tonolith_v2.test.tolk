import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@wrappers/TonolithCoreV2.gen"
import "@contracts/v2/commitments"
import "@contracts/v2/memory"
import "@contracts/v2/peers"
import "@contracts/v2/queues"
import "@contracts/v2/rom"
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
}
