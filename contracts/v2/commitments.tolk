import "types"

struct V2LegacyOutput {
    outputIndex: uint64
    instructionCount: uint64
    value: uint4
    outputCommitment: uint256
}

fun v2StaticCommitment(
    runId: uint256,
    coreId: uint16,
    programId: uint256,
    romRoot: uint256,
    routeRoot: uint256,
    peerRoot: uint256,
    limitsHash: uint256,
): uint256 {
    val programPayload = beginCell()
        .storeUint(programId, 256)
        .storeUint(romRoot, 256)
        .storeUint(routeRoot, 256)
        .endCell();
    val limitsPayload = beginCell().storeUint(limitsHash, 256).endCell();
    val peerPayload = beginCell().storeUint(peerRoot, 256).endCell();
    return beginCell()
        .storeUint(DOMAIN_STATIC_V2, 32)
        .storeUint(SCHEMA_VERSION_V2, 16)
        .storeUint(ISA_VERSION_V2, 16)
        .storeUint(ABI_VERSION_V2, 16)
        .storeUint(PROTOCOL_VERSION_V2, 16)
        .storeUint(runId, 256)
        .storeUint(coreId, 16)
        .storeRef(programPayload)
        .storeRef(limitsPayload)
        .storeRef(peerPayload)
        .endCell()
        .hash();
}

fun nextV2LegacyOutputCommitment(
    previous: uint256,
    outputIndex: uint64,
    instructionCount: uint64,
    value: uint4,
): uint256 {
    return beginCell()
        .storeUint(DOMAIN_OUTPUT_V2, 32)
        .storeUint(previous, 256)
        .storeUint(outputIndex, 64)
        .storeUint(instructionCount, 64)
        .storeUint(value, 4)
        .endCell()
        .hash();
}

fun nextV2AcknowledgementCommitment(previous: uint256, outputId: uint256): uint256 {
    return beginCell()
        .storeUint(DOMAIN_ACK_V2, 32)
        .storeUint(previous, 256)
        .storeUint(outputId, 256)
        .endCell()
        .hash();
}

fun v2OutputId(
    runId: uint256,
    sourceCoreId: uint16,
    destinationCoreId: uint16,
    sourceEpoch: uint64,
    destinationEpoch: uint64,
    sourcePort: uint4,
    destinationPort: uint4,
    sequence: uint8,
    value: uint4,
    sourceInstructionCount: uint64,
): uint256 {
    return beginCell()
        .storeUint(DOMAIN_OUTPUT_V2, 32)
        .storeUint(runId, 256)
        .storeUint(sourceCoreId, 16)
        .storeUint(destinationCoreId, 16)
        .storeUint(sourceEpoch, 64)
        .storeUint(destinationEpoch, 64)
        .storeUint(sourcePort, 4)
        .storeUint(destinationPort, 4)
        .storeUint(sequence, 8)
        .storeUint(value, 4)
        .storeUint(sourceInstructionCount, 64)
        .endCell()
        .hash();
}

fun nextV2OutputCommitment(
    previous: uint256,
    outputId: uint256,
    instructionCount: uint64,
    value: uint4,
): uint256 {
    return beginCell()
        .storeUint(DOMAIN_OUTPUT_V2, 32)
        .storeUint(previous, 256)
        .storeUint(outputId, 256)
        .storeUint(instructionCount, 64)
        .storeUint(value, 4)
        .endCell()
        .hash();
}

fun nextV2InputCommitment(
    previous: uint256,
    outputId: uint256,
    epoch: uint64,
    sequence: uint8,
    value: uint4,
    consumed: uint1,
): uint256 {
    return beginCell()
        .storeUint(DOMAIN_INPUT_V2, 32)
        .storeUint(previous, 256)
        .storeUint(outputId, 256)
        .storeUint(epoch, 64)
        .storeUint(sequence, 8)
        .storeUint(value, 4)
        .storeUint(consumed, 1)
        .endCell()
        .hash();
}

fun nextV2EpochCommitment(
    previous: uint256,
    epoch: uint64,
    stateHash: uint256,
    outputCommitment: uint256,
    inputCommitment: uint256,
): uint256 {
    val payload = beginCell()
        .storeUint(stateHash, 256)
        .storeUint(outputCommitment, 256)
        .storeUint(inputCommitment, 256)
        .endCell();
    return beginCell()
        .storeUint(DOMAIN_EPOCH_V2, 32)
        .storeUint(previous, 256)
        .storeUint(epoch, 64)
        .storeRef(payload)
        .endCell()
        .hash();
}

fun nextV2TraceCommitment(
    previous: uint256,
    instructionWord: uint16,
    nextStateHash: uint256,
): uint256 {
    return beginCell()
        .storeUint(DOMAIN_BATCH_V2, 32)
        .storeUint(previous, 256)
        .storeUint(instructionWord, 16)
        .storeUint(nextStateHash, 256)
        .endCell()
        .hash();
}

fun nextV2BatchCommitment(
    previousStateHash: uint256,
    nextStateHash: uint256,
    startInstructionCount: uint64,
    endInstructionCount: uint64,
    stepsExecuted: uint16,
    outputsProduced: uint8,
    stopReason: uint8,
    traceCommitment: uint256,
): uint256 {
    val detail = beginCell()
        .storeUint(previousStateHash, 256)
        .storeUint(nextStateHash, 256)
        .storeUint(startInstructionCount, 64)
        .storeUint(endInstructionCount, 64)
        .storeUint(stepsExecuted, 16)
        .storeUint(outputsProduced, 8)
        .storeUint(stopReason, 8)
        .storeUint(traceCommitment, 256)
        .endCell();
    return beginCell().storeUint(DOMAIN_BATCH_V2, 32).storeRef(detail).endCell().hash();
}

fun v2StateHash(core: V2CoreState): uint256 {
    return core.toCell().hash();
}
