import "commitments"
import "memory"
import "queues"
import "routes"
import "types"

fun v2HasFlag(flags: uint2, flag: uint2): bool {
    return (flags & flag) != 0;
}

fun v2SetZeroFlag(flags: uint2, value: uint4): uint2 {
    if (value == 0) {
        return (flags | FLAG_ZERO_V2) as uint2;
    }
    return (flags & ~FLAG_ZERO_V2) as uint2;
}

fun v2SetCarryFlag(flags: uint2, carry: bool): uint2 {
    if (carry) {
        return (flags | FLAG_CARRY_V2) as uint2;
    }
    return (flags & ~FLAG_CARRY_V2) as uint2;
}

fun v2AddAccumulator(mutate core: V2CoreState, operand: uint4, includeCarry: bool) {
    val incomingCarry = includeCarry && v2HasFlag(core.flags, FLAG_CARRY_V2) ? 1 : 0;
    val sum = core.accumulator + operand + incomingCarry;
    core.accumulator = (sum & 15) as uint4;
    core.flags = v2SetCarryFlag(core.flags, sum >= 16);
    core.flags = v2SetZeroFlag(core.flags, core.accumulator);
}

fun v2SubtractAccumulator(mutate core: V2CoreState, operand: uint4) {
    val before = core.accumulator;
    core.accumulator = ((before - operand) & 15) as uint4;
    core.flags = v2SetCarryFlag(core.flags, before >= operand);
    core.flags = v2SetZeroFlag(core.flags, core.accumulator);
}

fun v2LogicalAccumulator(mutate core: V2CoreState, value: uint4) {
    core.accumulator = value;
    core.flags = v2SetCarryFlag(core.flags, false);
    core.flags = v2SetZeroFlag(core.flags, core.accumulator);
}

fun v2GetOutputSequence(packed: uint128, port: int): uint8 {
    assert (port >= 0 && port < 16) throw ErrorsV2.InvalidRoute;
    return ((packed >> (port * 8)) & 255) as uint8;
}

fun v2SetOutputSequence(packed: uint128, port: int, sequence: uint8): uint128 {
    assert (port >= 0 && port < 16) throw ErrorsV2.InvalidRoute;
    val shift = port * 8;
    val mask = 255 << shift;
    return ((packed & ~mask) | (sequence << shift)) as uint128;
}

fun v2ExecuteSys(
    mutate core: V2CoreState,
    operand: int,
    runId: uint256,
    coreId: uint16,
    routes: cell,
    beforeStateHash: uint256,
): V2LegacyOutput? {
    val subop = operand & 15;
    if (subop == 0) {
        core.status = STATUS_HALTED_V2;
        return null;
    }
    if (subop == 1) {
        val outputIndex = core.outputCount;
        val value = core.accumulator;
        val commitment = nextV2LegacyOutputCommitment(
            core.commitments.load().outputCommitment,
            outputIndex,
            core.instructionCount,
            value,
        );
        core.outputCount += 1;
        var commitments = core.commitments.load();
        commitments.outputCommitment = commitment;
        core.commitments = commitments.toCell();
        return V2LegacyOutput {
            outputIndex,
            instructionCount: core.instructionCount,
            value,
            outputCommitment: commitment,
        };
    }
    if (subop == 2) {
        core.flags = v2SetCarryFlag(core.flags, false);
        return null;
    }
    if (subop == 3) {
        core.flags = v2SetCarryFlag(core.flags, true);
        return null;
    }
    if (subop == 4) {
        v2LogicalAccumulator(mutate core, ((~core.accumulator) & 15) as uint4);
        return null;
    }
    if (subop == 5) {
        val before = core.accumulator;
        core.flags = v2SetCarryFlag(core.flags, (before & 8) != 0);
        core.accumulator = ((before << 1) & 15) as uint4;
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 6) {
        val before = core.accumulator;
        core.flags = v2SetCarryFlag(core.flags, (before & 1) != 0);
        core.accumulator = (before >> 1) as uint4;
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 7) {
        val before = core.accumulator;
        core.accumulator = ((before + 1) & 15) as uint4;
        core.flags = v2SetCarryFlag(core.flags, before == 15);
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 8) {
        val before = core.accumulator;
        core.accumulator = ((before - 1) & 15) as uint4;
        core.flags = v2SetCarryFlag(core.flags, before != 0);
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (subop == 9) {
        val port = operand >> 4;
        val queues = core.queues.load();
        val cursor = v2FindInput(queues.inboxRoot, core.epoch, port);
        if (cursor.found == 0) {
            core.pc = ((core.pc - 1) & 1023) as uint10;
            core.instructionCount -= 1;
            core.status = STATUS_WAITING_INPUT_V2;
            return null;
        }
        val input = v2InputAt(queues.inboxRoot, cursor.index);
        val consumed = V2InputRecord {
            domain: input.domain,
            outputId: input.outputId,
            sourceCoreId: input.sourceCoreId,
            destinationCoreId: input.destinationCoreId,
            sourceEpoch: input.sourceEpoch,
            destinationEpoch: input.destinationEpoch,
            sourcePort: input.sourcePort,
            destinationPort: input.destinationPort,
            sequence: input.sequence,
            value: input.value,
            sourceInstructionCount: input.sourceInstructionCount,
            sourceStateHash: input.sourceStateHash,
            consumed: 1,
        }.toCell();
        var newQueues = queues;
        newQueues.inboxRoot = v2ReplaceRecordAt(queues.inboxRoot, cursor.index, consumed);
        core.queues = newQueues.toCell();
        core.accumulator = input.value;
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        var commitments = core.commitments.load();
        commitments.inputCommitment = nextV2InputCommitment(
            commitments.inputCommitment,
            input.outputId,
            input.destinationEpoch,
            input.sequence,
            input.value,
            1,
        );
        core.commitments = commitments.toCell();
        return null;
    }
    if (subop == 10) {
        val port = operand >> 4;
        val queues = core.queues.load();
        if (v2QueueCount(queues.outboxRoot) >= MAX_OUTPUT_RECORDS_V2) {
            // A blocked OUTP is not an executed instruction. Restore the
            // fetch counters and leave the core in an observable stop state
            // so a later acknowledgement can wake it safely.
            core.pc = ((core.pc - 1) & 1023) as uint10;
            core.instructionCount -= 1;
            core.status = STATUS_BACKPRESSURED_V2;
            return null;
        }
        val route = v2FindRoute(routes, coreId, port);
        assert (route != null) throw ErrorsV2.InvalidRoute;
        val sequence = v2GetOutputSequence(core.nextOutputSequence, port);
        assert (sequence < 255) throw ErrorsV2.InvalidSequence;
        val destinationEpoch = core.epoch + route!.delay;
        val outputId = v2OutputId(
            runId,
            coreId,
            route!.destinationCoreId,
            core.epoch,
            destinationEpoch,
            port as uint4,
            route!.destinationPort,
            sequence,
            core.accumulator,
            core.instructionCount,
        );
        val output = V2OutputRecord {
            domain: DOMAIN_OUTPUT_V2,
            outputId,
            sourceCoreId: coreId,
            destinationCoreId: route!.destinationCoreId,
            sourceEpoch: core.epoch,
            destinationEpoch,
            sourcePort: port as uint4,
            destinationPort: route!.destinationPort,
            sequence,
            value: core.accumulator,
            sourceInstructionCount: core.instructionCount,
            sourceStateHash: beforeStateHash,
        }.toCell();
        var updatedQueues = queues;
        updatedQueues.outboxRoot = v2AppendQueueRoot(queues.outboxRoot, output);
        core.queues = updatedQueues.toCell();
        core.nextOutputSequence = v2SetOutputSequence(core.nextOutputSequence, port, sequence + 1);
        core.outputCount += 1;
        var outputCommitments = core.commitments.load();
        outputCommitments.outputCommitment = nextV2OutputCommitment(
            outputCommitments.outputCommitment,
            outputId,
            core.instructionCount,
            core.accumulator,
        );
        core.commitments = outputCommitments.toCell();
        return null;
    }
    if (subop == 11) {
        val commitments = core.commitments.load();
        val closedStateHash = core.toCell().hash();
        var nextCommitments = commitments;
        nextCommitments.epochHistoryCommitment = nextV2EpochCommitment(
            commitments.epochHistoryCommitment,
            core.epoch,
            closedStateHash,
            commitments.outputCommitment,
            commitments.inputCommitment,
        );
        core.commitments = nextCommitments.toCell();
        core.epoch += 1;
        core.status = STATUS_RUNNING_V2;
        return null;
    }
    if (subop == 12) {
        core.status = STATUS_FAULTED_V2;
        core.faultCode = (operand >> 4) as uint8;
        return null;
    }
    throw ErrorsV2.InvalidInstruction;
}

fun v2ExecuteInstruction(
    mutate core: V2CoreState,
    word: uint16,
    runId: uint256,
    coreId: uint16,
    routes: cell,
    beforeStateHash: uint256,
): V2LegacyOutput? {
    val opcode = word >> 12;
    val operand = word & 0xFFF;
    if (opcode == 0 && operand != 0) {
        throw ErrorsV2.InvalidInstruction;
    }
    if (opcode == 1 && operand > 15) {
        throw ErrorsV2.InvalidInstruction;
    }
    if (opcode >= 2 && opcode <= 9 && operand > 15) {
        throw ErrorsV2.InvalidInstruction;
    }
    if ((opcode == 10 || opcode == 11) && operand > 255) {
        throw ErrorsV2.InvalidInstruction;
    }
    if (opcode >= 12 && opcode <= 14 && operand > 1023) {
        throw ErrorsV2.InvalidInstruction;
    }
    if (opcode == 15) {
        val subop = operand & 15;
        if (subop <= 8 || subop == 11) {
            assert (operand == subop) throw ErrorsV2.InvalidInstruction;
        } else if (subop == 9 || subop == 10) {
            assert ((operand >> 4) < 16) throw ErrorsV2.InvalidInstruction;
        } else if (subop == 12) {
            // The upper eight bits are the architectural TRAP code.
        } else {
            throw ErrorsV2.InvalidInstruction;
        }
    }
    core.pc = ((core.pc + 1) & 1023) as uint10;
    core.instructionCount += 1;

    if (opcode == 0) {
        return null;
    }
    if (opcode == 1) {
        core.accumulator = operand as uint4;
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (opcode == 2) {
        core.accumulator = readV2Register(core, operand);
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (opcode == 3) {
        writeV2Register(mutate core, operand, core.accumulator);
        return null;
    }
    if (opcode == 4) {
        v2AddAccumulator(mutate core, readV2Register(core, operand), false);
        return null;
    }
    if (opcode == 5) {
        v2AddAccumulator(mutate core, readV2Register(core, operand), true);
        return null;
    }
    if (opcode == 6) {
        v2SubtractAccumulator(mutate core, readV2Register(core, operand));
        return null;
    }
    if (opcode == 7) {
        v2LogicalAccumulator(
            mutate core,
            (core.accumulator & readV2Register(core, operand)) as uint4,
        );
        return null;
    }
    if (opcode == 8) {
        v2LogicalAccumulator(
            mutate core,
            (core.accumulator | readV2Register(core, operand)) as uint4,
        );
        return null;
    }
    if (opcode == 9) {
        v2LogicalAccumulator(
            mutate core,
            (core.accumulator ^ readV2Register(core, operand)) as uint4,
        );
        return null;
    }
    if (opcode == 10) {
        core.accumulator = readV2Ram(core, operand);
        core.flags = v2SetZeroFlag(core.flags, core.accumulator);
        return null;
    }
    if (opcode == 11) {
        writeV2Ram(mutate core, operand, core.accumulator);
        return null;
    }
    if (opcode == 12) {
        core.pc = operand as uint10;
        return null;
    }
    if (opcode == 13) {
        if (v2HasFlag(core.flags, FLAG_ZERO_V2)) {
            core.pc = operand as uint10;
        }
        return null;
    }
    if (opcode == 14) {
        if (v2HasFlag(core.flags, FLAG_CARRY_V2)) {
            core.pc = operand as uint10;
        }
        return null;
    }
    return v2ExecuteSys(
        mutate core,
        operand,
        runId,
        coreId,
        routes,
        beforeStateHash,
    );
}
