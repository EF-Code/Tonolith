import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@wrappers/TonolithCoreV2.gen"
import "@contracts/v2/memory"
import "@contracts/v2/queues"
import "@contracts/v2/rom"
import "@contracts/v2/types"

fun batchStorage(rom: Cell<V2RomRoot>, routes: cell): V2Storage {
    val staticRoots = V2StaticRoots {
        romRoot: rom.hash(),
        routeRoot: routes.hash(),
        limitsHash: 0,
        peers: V2PeerRoots { peerRoot: emptyV2RecordRoot().hash() }.toCell(),
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
        network: V2NetworkData {
            routes,
            peers: emptyV2RecordRoot(),
        }.toCell(),
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

fun batchAdvance(core: TonolithCoreV2, from: address, maxOutputs: uint8 = MAX_OUTPUT_RECORDS_V2) {
    val result = core.sendV2Advance(
        from,
        ABI_VERSION_V2,
        0,
        core.getRunIdV2(),
        core.getAdvanceCountV2(),
        core.getCoreStateHashV2(),
        MAX_STEPS_PER_ADVANCE_V2,
        maxOutputs,
        { bounce: false, value: ton("0.1") },
    );
    expect(result).toHaveSuccessfulTx<V2Advance>();
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

get fun `test v2 bounded advance executes the full configured nop batch`() {
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

get fun `test v2 bounded advance stops at a legacy output event`() {
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

get fun `test v2 bounded advance stops at a routed output event`() {
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

get fun `test v2 bounded advance stops at yield and trap`() {
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

get fun `test v2 bounded advance records input wait without executing`() {
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

get fun `test v2 bounded advance records outbox backpressure without executing`() {
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
