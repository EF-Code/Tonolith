import "@acton/testing/expect"

import "@contracts/v2/execution"
import "@contracts/v2/memory"
import "@contracts/v2/queues"
import "@contracts/v2/types"

fun emptyV2ExecutionQueueRoot(): cell {
    val page = beginCell().storeUint(0, 3).endCell();
    return beginCell()
        .storeUint(0, 5)
        .storeRef(page)
        .storeRef(page)
        .storeRef(page)
        .storeRef(page)
        .endCell();
}

fun executionCoreV2(): V2CoreState {
    return V2CoreState {
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
        commitments: V2CoreCommitments {
            outputCommitment: 0,
            inputCommitment: 0,
            epochHistoryCommitment: 0,
        }.toCell(),
        memory: zeroV2Memory(),
        queues: V2QueueRoots {
            inboxRoot: emptyV2ExecutionQueueRoot(),
            outboxRoot: emptyV2ExecutionQueueRoot(),
        }.toCell(),
    };
}

fun executionRouteV2(): cell {
    return V2Route {
        domain: DOMAIN_ROUTE_V2,
        sourceCoreId: 0,
        sourcePort: 3,
        destinationCoreId: 9,
        destinationPort: 4,
        delay: 2,
        maxRecordsPerEpoch: 16,
    }.toCell();
}

fun executionOutputV2(index: int): cell {
    return V2OutputRecord {
        domain: DOMAIN_OUTPUT_V2,
        outputId: (1000 + index) as uint256,
        sourceCoreId: 0,
        destinationCoreId: 9,
        sourceEpoch: 0,
        destinationEpoch: 2,
        sourcePort: 3,
        destinationPort: 4,
        sequence: index as uint8,
        value: index as uint4,
        sourceInstructionCount: (index + 1) as uint64,
        sourceStateHash: (index + 2) as uint256,
    }.toCell();
}

fun executionInputV2(): cell {
    return V2InputRecord {
        domain: DOMAIN_INPUT_V2,
        outputId: 77,
        sourceCoreId: 4,
        destinationCoreId: 0,
        sourceEpoch: 0,
        destinationEpoch: 1,
        sourcePort: 1,
        destinationPort: 2,
        sequence: 0,
        value: 13,
        sourceInstructionCount: 8,
        sourceStateHash: 9,
        consumed: 0,
    }.toCell();
}

fun executionRouteRootV2(): cell {
    return v2AppendQueueRoot(emptyV2ExecutionQueueRoot(), executionRouteV2());
}

get fun `test v2 execution covers inherited instructions and flag outcomes`() {
    var core = executionCoreV2();
    val routes = emptyV2ExecutionQueueRoot();
    v2ExecuteInstruction(
        mutate core,
        0x0000,
        1,
        0,
        routes,
        2,
    );
    expect(core.pc).toEqual(1);
    expect(core.instructionCount).toEqual(1);

    core = executionCoreV2();
    v2ExecuteInstruction(
        mutate core,
        0x100F,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(15);
    expect(core.flags).toEqual(0);

    core = executionCoreV2();
    writeV2Register(mutate core, 0, 9);
    v2ExecuteInstruction(
        mutate core,
        0x2000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(9);
    expect(core.flags).toEqual(0);

    core = executionCoreV2();
    core.accumulator = 6;
    v2ExecuteInstruction(
        mutate core,
        0x3001,
        1,
        0,
        routes,
        2,
    );
    expect(readV2Register(core, 1)).toEqual(6);

    core = executionCoreV2();
    core.accumulator = 15;
    writeV2Register(mutate core, 0, 1);
    v2ExecuteInstruction(
        mutate core,
        0x4000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(0);
    expect(core.flags).toEqual(3);

    core = executionCoreV2();
    core.accumulator = 0;
    core.flags = FLAG_CARRY_V2;
    writeV2Register(mutate core, 0, 1);
    v2ExecuteInstruction(
        mutate core,
        0x5000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(2);
    expect(core.flags).toEqual(0);

    core = executionCoreV2();
    core.accumulator = 0;
    writeV2Register(mutate core, 0, 1);
    v2ExecuteInstruction(
        mutate core,
        0x6000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(15);
    expect(core.flags).toEqual(0);

    core = executionCoreV2();
    core.accumulator = 0xC;
    writeV2Register(mutate core, 0, 0xA);
    v2ExecuteInstruction(
        mutate core,
        0x7000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(8);
    expect(core.flags).toEqual(0);

    core = executionCoreV2();
    core.accumulator = 0xC;
    writeV2Register(mutate core, 0, 3);
    v2ExecuteInstruction(
        mutate core,
        0x8000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(15);

    core = executionCoreV2();
    core.accumulator = 0xC;
    writeV2Register(mutate core, 0, 0xA);
    v2ExecuteInstruction(
        mutate core,
        0x9000,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(6);

    core = executionCoreV2();
    writeV2Ram(mutate core, 64, 0xB);
    v2ExecuteInstruction(
        mutate core,
        0xA040,
        1,
        0,
        routes,
        2,
    );
    expect(core.accumulator).toEqual(0xB);

    core = executionCoreV2();
    core.accumulator = 0xC;
    v2ExecuteInstruction(
        mutate core,
        0xB0C0,
        1,
        0,
        routes,
        2,
    );
    expect(readV2Ram(core, 192)).toEqual(0xC);

    core = executionCoreV2();
    v2ExecuteInstruction(
        mutate core,
        0xC123,
        1,
        0,
        routes,
        2,
    );
    expect(core.pc).toEqual(0x123);

    core = executionCoreV2();
    core.flags = FLAG_ZERO_V2;
    v2ExecuteInstruction(
        mutate core,
        0xD123,
        1,
        0,
        routes,
        2,
    );
    expect(core.pc).toEqual(0x123);

    core = executionCoreV2();
    v2ExecuteInstruction(
        mutate core,
        0xD123,
        1,
        0,
        routes,
        2,
    );
    expect(core.pc).toEqual(1);

    core = executionCoreV2();
    core.flags = FLAG_CARRY_V2;
    v2ExecuteInstruction(
        mutate core,
        0xE123,
        1,
        0,
        routes,
        2,
    );
    expect(core.pc).toEqual(0x123);

    core = executionCoreV2();
    v2ExecuteInstruction(
        mutate core,
        0xE123,
        1,
        0,
        routes,
        2,
    );
    expect(core.pc).toEqual(1);
}

get fun `test v2 SYS arithmetic output and architectural state transitions`() {
    var core = executionCoreV2();
    core.accumulator = 9;
    core.instructionCount = 4;
    val output = v2ExecuteInstruction(
        mutate core,
        0xF001,
        0x11,
        0,
        emptyV2ExecutionQueueRoot(),
        0x22,
    );
    expect(output).toNotEqual(null);
    expect(output!.value).toEqual(9);
    expect(output!.outputIndex).toEqual(0);
    expect(output!.instructionCount).toEqual(5);
    expect(core.outputCount).toEqual(1);
    expect(core.commitments.load().outputCommitment).toEqual(output!.outputCommitment);

    core = executionCoreV2();
    core.flags = FLAG_CARRY_V2;
    v2ExecuteSys(
        mutate core,
        2,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.flags).toEqual(0);
    v2ExecuteSys(
        mutate core,
        3,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.flags).toEqual(FLAG_CARRY_V2);

    core.accumulator = 5;
    v2ExecuteSys(
        mutate core,
        4,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.accumulator).toEqual(10);
    core.accumulator = 9;
    v2ExecuteSys(
        mutate core,
        5,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.accumulator).toEqual(2);
    expect(core.flags & FLAG_CARRY_V2).toEqual(FLAG_CARRY_V2);
    core.accumulator = 9;
    v2ExecuteSys(
        mutate core,
        6,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.accumulator).toEqual(4);
    expect(core.flags & FLAG_CARRY_V2).toEqual(FLAG_CARRY_V2);
    core.accumulator = 15;
    v2ExecuteSys(
        mutate core,
        7,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.accumulator).toEqual(0);
    expect(core.flags).toEqual(3);
    core.accumulator = 0;
    v2ExecuteSys(
        mutate core,
        8,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.accumulator).toEqual(15);
    expect(core.flags & FLAG_CARRY_V2).toEqual(0);

    core = executionCoreV2();
    v2ExecuteSys(
        mutate core,
        0,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.status).toEqual(STATUS_HALTED_V2);

    core = executionCoreV2();
    core.pc = 1;
    core.instructionCount = 1;
    v2ExecuteSys(
        mutate core,
        0x29,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.pc).toEqual(0);
    expect(core.instructionCount).toEqual(0);
    expect(core.status).toEqual(STATUS_WAITING_INPUT_V2);

    core = executionCoreV2();
    core.epoch = 1;
    var inputQueues = core.queues.load();
    inputQueues.inboxRoot = v2AppendQueueRoot(inputQueues.inboxRoot, executionInputV2());
    core.queues = inputQueues.toCell();
    v2ExecuteSys(
        mutate core,
        0x29,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.accumulator).toEqual(13);
    expect(core.commitments.load().inputCommitment).toNotEqual(0);
    expect(v2InputAt(core.queues.load().inboxRoot, 0).consumed).toEqual(1);

    core = executionCoreV2();
    core.pc = 1;
    core.instructionCount = 1;
    core.accumulator = 7;
    val outputRoutes = executionRouteRootV2();
    v2ExecuteSys(
        mutate core,
        0x3A,
        1,
        0,
        outputRoutes,
        0x44,
    );
    expect(v2QueueCount(core.queues.load().outboxRoot)).toEqual(1);
    expect(v2OutputAt(core.queues.load().outboxRoot, 0).value).toEqual(7);
    expect(v2GetOutputSequence(core.nextOutputSequence, 3)).toEqual(1);

    core = executionCoreV2();
    core.pc = 1;
    core.instructionCount = 1;
    core.queues = V2QueueRoots {
        inboxRoot: emptyV2ExecutionQueueRoot(),
        outboxRoot: emptyV2ExecutionQueueRoot(),
    }.toCell();
    var fullOutbox = core.queues.load();
    repeat (16) {
        fullOutbox.outboxRoot = v2AppendQueueRoot(
            fullOutbox.outboxRoot,
            executionOutputV2(v2QueueCount(fullOutbox.outboxRoot)),
        );
    }
    core.queues = fullOutbox.toCell();
    v2ExecuteSys(
        mutate core,
        0x3A,
        1,
        0,
        outputRoutes,
        0x44,
    );
    expect(core.status).toEqual(STATUS_BACKPRESSURED_V2);
    expect(core.pc).toEqual(0);
    expect(core.instructionCount).toEqual(0);

    var caughtMissingRoute = false;
    core = executionCoreV2();
    core.pc = 1;
    core.instructionCount = 1;
    try {
        v2ExecuteSys(
            mutate core,
            0x3A,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtMissingRoute = true;
        expect(e).toEqual(161);
    }
    expect(caughtMissingRoute).toEqual(true);

    val sequence = v2SetOutputSequence(0, 15, 254);
    expect(v2GetOutputSequence(sequence, 15)).toEqual(254);

    core = executionCoreV2();
    v2ExecuteSys(
        mutate core,
        11,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.epoch).toEqual(1);
    expect(core.status).toEqual(STATUS_RUNNING_V2);
    expect(core.commitments.load().epochHistoryCommitment).toNotEqual(0);

    core = executionCoreV2();
    v2ExecuteSys(
        mutate core,
        0xAC,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.status).toEqual(STATUS_FAULTED_V2);
    expect(core.faultCode).toEqual(10);

    v2ExecuteSys(
        mutate core,
        13,
        1,
        0,
        emptyV2ExecutionQueueRoot(),
        0,
    );
    expect(core.status).toEqual(STATUS_FAULTED_V2);
}

get fun `test v2 instruction validation rejects every noncanonical operand class`() {
    var caughtNop = false;
    var core = executionCoreV2();
    expect(core.pc).toEqual(0);
    try {
        v2ExecuteInstruction(
            mutate core,
            0x0001,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtNop = true;
        expect(e).toEqual(140);
    }
    expect(caughtNop).toEqual(true);

    var caughtImmediate = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0x1010,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtImmediate = true;
        expect(e).toEqual(140);
    }
    expect(caughtImmediate).toEqual(true);

    var caughtRegister = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0x2010,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtRegister = true;
        expect(e).toEqual(140);
    }
    expect(caughtRegister).toEqual(true);

    var caughtRam = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0xA100,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtRam = true;
        expect(e).toEqual(140);
    }
    expect(caughtRam).toEqual(true);

    var caughtJump = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0xC400,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtJump = true;
        expect(e).toEqual(140);
    }
    expect(caughtJump).toEqual(true);

    var caughtSys = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0xF00D,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtSys = true;
        expect(e).toEqual(140);
    }
    expect(caughtSys).toEqual(true);

    var caughtSysPort = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0xF109,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtSysPort = true;
        expect(e).toEqual(140);
    }
    expect(caughtSysPort).toEqual(true);

    var caughtUnknownSys = false;
    core = executionCoreV2();
    try {
        v2ExecuteInstruction(
            mutate core,
            0xF00E,
            1,
            0,
            emptyV2ExecutionQueueRoot(),
            0,
        );
    } catch (e) {
        caughtUnknownSys = true;
        expect(e).toEqual(140);
    }
    expect(caughtUnknownSys).toEqual(true);
}
