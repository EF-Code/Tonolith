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

fun fibonacciRom(): Cell<RomRoot> {
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
    return romRootWithFirstLeaf(
        RomLeaf { firstHalf, secondHalf }.toCell(),
    );
}
