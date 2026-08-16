import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@contracts/types"
import "@wrappers/TonolithCpu.gen"

fun main() {
    val deployer = scripts.wallet("deployer");

    val cpu = TonolithCpu.fromStorage(makeStorage(zeroRomRoot()));
    val res = cpu.deploy(deployer.address, { value: ton("1") });
    println(res.waitForTrace());

    println("Deployed TonolithCpu to {}", cpu.address);
    println("Magic: {}", cpu.getMagic());
    println("Schema version: {}", cpu.getSchemaVersion());
    println("ISA version: {}", cpu.getIsaVersion());
}
