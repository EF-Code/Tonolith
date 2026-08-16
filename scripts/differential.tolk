import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@contracts/types"
import "@wrappers/TonolithCpu.gen"

fun main() {
    val deployer = scripts.wallet("differential");
    val rom = romWithWords(
        0x100F,
        0x3000,
        0x1001,
        0x4000,
        0x5000,
        0x6000,
        0x7000,
        0x8000,
        0x9000,
        0xF003,
        0xF002,
        0xF004,
        0xF005,
        0xF006,
        0xF007,
        0xF008,
    );
    val cpu = TonolithCpu.fromStorage(
        makeStorage(rom),
    );
    cpu.deploy(deployer.address, { value: ton("1") }).waitForFirstTransaction();

    println("ROM|{}|{}", cpu.getRomRootHash(), cpu.getStaticCommitment());

    repeat (16) {
        val result = cpu.sendAdvance(
            deployer.address,
            cpu.getAdvanceCount(),
            cpu.getAdvanceCount(),
            cpu.getCoreStateHash(),
            1,
            { value: ton("0.1") },
        );
        result.waitForFirstTransaction();
        println(
            "TRACE|{}|{}|{}|{}|{}",
            cpu.getAdvanceCount(),
            cpu.getInstructionCount(),
            cpu.getPc(),
            cpu.getAccumulator(),
            cpu.getFlags(),
        );
        println(
            "TRACE2|{}|{}|{}|{}",
            cpu.getStatus(),
            cpu.getRegisters(),
            cpu.getOutputCount(),
            cpu.getCoreStateHash(),
        );
    }
}

fun romWithWords(
    word0: uint16,
    word1: uint16,
    word2: uint16,
    word3: uint16,
    word4: uint16,
    word5: uint16,
    word6: uint16,
    word7: uint16,
    word8: uint16,
    word9: uint16,
    word10: uint16,
    word11: uint16,
    word12: uint16,
    word13: uint16,
    word14: uint16,
    word15: uint16,
): Cell<RomRoot> {
    val firstBuilder = beginCell()
        .storeUint(word0, 16)
        .storeUint(word1, 16)
        .storeUint(word2, 16)
        .storeUint(word3, 16)
        .storeUint(word4, 16)
        .storeUint(word5, 16)
        .storeUint(word6, 16)
        .storeUint(word7, 16)
        .storeUint(word8, 16)
        .storeUint(word9, 16)
        .storeUint(word10, 16)
        .storeUint(word11, 16)
        .storeUint(word12, 16)
        .storeUint(word13, 16)
        .storeUint(word14, 16)
        .storeUint(word15, 16);
    var firstSlice = firstBuilder.toSlice();
    val firstHalf = firstSlice.loadUint(256) as uint256;
    return romRootWithFirstLeaf(
        RomLeaf {
            firstHalf,
            secondHalf: 0,
        }.toCell(),
    );
}
