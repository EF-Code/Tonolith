import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@contracts/types"
import "@wrappers/TonolithCpu.gen"

fun main() {
    val deployer = scripts.wallet("tonolith-testnet");
    val rom = fibonacciRom();
    val cpu = TonolithCpu.fromStorage(makeStorage(rom));
    val deploy = cpu.deploy(deployer.address, { value: ton("1") });
    println(deploy.waitForTrace());

    val init = cpu.stateInit;
    if (init != null) {
        println("INIT|{}|{}", init.code.hash(), init.data.hash());
    }
    println(
        "DEPLOY|{}|{}|{}|{}|{}",
        cpu.address,
        cpu.getRomRootHash(),
        cpu.getStaticCommitment(),
        cpu.getCoreStateHash(),
        cpu.getStatus(),
    );

    var ticks = 0;
    while (cpu.getStatus() == 0 && ticks < 200) {
        val advanceCount = cpu.getAdvanceCount();
        val stateHash = cpu.getCoreStateHash();
        val tick = cpu.sendAdvance(
            deployer.address,
            advanceCount,
            advanceCount,
            stateHash,
            1,
            { value: ton("0.01") },
        );
        println(tick.waitForTrace());
        ticks += 1;
        println(
            "STATE|{}|{}|{}|{}|{}",
            ticks,
            cpu.getAdvanceCount(),
            cpu.getInstructionCount(),
            cpu.getPc(),
            cpu.getAccumulator(),
        );
        println(
            "STATE2|{}|{}",
            cpu.getOutputCount(),
            cpu.getCoreStateHash(),
        );
    }

    println("FINAL|{}|{}|{}", cpu.getStatus(), cpu.getOutputCount(), cpu.getOutputRegister());
}

