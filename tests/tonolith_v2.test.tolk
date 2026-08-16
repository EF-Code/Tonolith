import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@wrappers/TonolithCoreV2.gen"
import "@contracts/v2/memory"
import "@contracts/v2/rom"
import "@contracts/v2/types"

fun makeV2StorageForTest(rom: Cell<V2RomRoot>): V2Storage {
    val staticRoots = V2StaticRoots {
        romRoot: rom.hash(),
        routeRoot: 0,
        limitsHash: 0,
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
        routes: beginCell().endCell(),
    };
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
