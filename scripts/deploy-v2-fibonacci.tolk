import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@wrappers/TonolithCoreV2.gen"
import "@contracts/v2/memory"
import "@contracts/v2/rom"
import "@contracts/v2/types"

const V2_RUN_ID: uint256 = 0x9d74f5c6d97a5cca67a4f8811b67bc49e2ec29d0f04f09fc1c07a045518a1ca3
const V2_PROGRAM_ID: uint256 = 0xe140cb991c86e81663dbe688da3e6a2b18d14b260b0aca0a0c7b1381707a7dda
const V2_ROM_ROOT: uint256 = 0x029ccf15774f680518705bb7c8be4b2ca92f34a4ceb9c963e55609225398c748
const V2_RAM_ROOT: uint256 = 0xed807133df392920f6ed73d30ab7e67ecaee528d940e1be1ea8e44cd25031b8e
const V2_ROUTE_ROOT: uint256 = 0x9e548d24c3c980ff9fe617f92286289613d6deae0b0da0cbe88aa8a51e6d9bcb
const V2_LIMITS_HASH: uint256 = 0xf8d3ee4ee34e55e437aa1decfa2742d81aa6d623beec67c9394d736376beb1fb
const V2_STATIC_COMMITMENT: uint256 = 0x2c5978dc7ca91a1899cd345f5e9232500f50670ac7612fddb30f64eb879677f9

fun main() {
    val deployer = scripts.wallet("tonolith-testnet");
    val core = TonolithCoreV2.fromStorage(fibonacciStorage());
    val deploy = core.deploy(deployer.address, { value: ton("1") });
    println(deploy.waitForTrace());
    val init = core.stateInit;
    if (init != null) {
        println("INIT|{}|{}|{}", core.address, init.code.hash(), init.data.hash());
    }
    println("DEPLOY|{}|{}|{}", core.address, core.getProgramIdV2(), core.getRomRootV2());
    println(
        "COMMIT|{}|{}|{}",
        core.getRouteRootV2(),
        core.getStaticCommitmentV2(),
        core.getCoreStateHashV2(),
    );

    var ticks = 0;
    while (core.getStatusV2() == STATUS_RUNNING_V2 && ticks < 200) {
        val advanceCount = core.getAdvanceCountV2();
        val stateHash = core.getCoreStateHashV2();
        val tick = core.sendV2Advance(
            deployer.address,
            ABI_VERSION_V2,
            ticks,
            V2_RUN_ID,
            advanceCount,
            stateHash,
            MAX_STEPS_PER_ADVANCE_V2,
            MAX_OUTPUT_RECORDS_V2,
            { value: ton("0.01") },
        );
        println(tick.waitForTrace());
        println(
            "STATE|{}|{}|{}|{}|{}",
            ticks + 1,
            core.getAdvanceCountV2(),
            core.getInstructionCountV2(),
            core.getPcV2(),
            core.getAccumulatorV2(),
        );
        println("STATE2|{}|{}", core.getOutputCountV2(), core.getCoreStateHashV2());
        ticks += 1;
    }
    println(
        "FINAL|{}|{}|{}|{}",
        core.getStatusV2(),
        core.getOutputCountV2(),
        core.getInstructionCountV2(),
        core.getCoreStateHashV2(),
    );
}

fun fibonacciStorage(): V2Storage {
    val routes = emptyV2RecordRoot();
    val peers = emptyV2RecordRoot();
    val staticRoots = V2StaticRoots {
        romRoot: V2_ROM_ROOT,
        routeRoot: V2_ROUTE_ROOT,
        limitsHash: V2_LIMITS_HASH,
        peers: V2PeerRoots { peerRoot: peers.hash() }.toCell(),
    }.toCell();
    val identity = V2StaticData {
        coreId: 0,
        runId: V2_RUN_ID,
        staticCommitment: V2_STATIC_COMMITMENT,
        programId: V2_PROGRAM_ID,
        roots: staticRoots,
    }.toCell();
    val core = V2CoreState {
        domain: DOMAIN_STATE_V2,
        staticCommitment: V2_STATIC_COMMITMENT,
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
        rom: fibonacciRom(),
        network: V2NetworkData { routes, peers }.toCell(),
    };
}

fun fibonacciRom(): Cell<V2RomRoot> {
    val firstHalf = beginCell()
        .storeUint(0x1001, 16)
        .storeUint(0x3000, 16)
        .storeUint(0x1001, 16)
        .storeUint(0x3001, 16)
        .storeUint(0x1007, 16)
        .storeUint(0x3002, 16)
        .storeUint(0x2000, 16)
        .storeUint(0xF001, 16)
        .storeUint(0x2002, 16)
        .storeUint(0xF008, 16)
        .storeUint(0x3002, 16)
        .storeUint(0xD014, 16)
        .storeUint(0x2000, 16)
        .storeUint(0x4001, 16)
        .storeUint(0x3003, 16)
        .storeUint(0x2001, 16)
        .toSlice()
        .loadUint(256) as uint256;
    val secondHalf = beginCell()
        .storeUint(0x3000, 16)
        .storeUint(0x2003, 16)
        .storeUint(0x3001, 16)
        .storeUint(0xC006, 16)
        .storeUint(0xF000, 16)
        .storeUint(0, 176)
        .toSlice()
        .loadUint(256) as uint256;
    return v2RomWithFirstLeaf(
        V2RomLeaf { firstHalf, secondHalf }.toCell(),
    );
}
