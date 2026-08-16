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

