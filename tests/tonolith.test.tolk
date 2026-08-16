import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/types/message"
import "@acton/types/out_actions"

import "@contracts/types"
import "@wrappers/TonolithCpu.gen"

get fun `test deploy exposes Tonolith metadata`() {
    val deployer = testing.treasury("deployer");
    val cpu = TonolithCpu.fromStorage(makeStorage(zeroRomRoot()));
    val res = cpu.deploy(deployer.address, { value: ton("1") });
    expect(res).toHaveSuccessfulDeploy({ to: cpu.address });

    expect(cpu.getMagic()).toEqual(0x544E4C31);
    expect(cpu.getSchemaVersion()).toEqual(1);
    expect(cpu.getIsaVersion()).toEqual(1);
    expect(cpu.getCoreStateHash()).toEqual(
        0x6e6f002233a671b50abcce37a46b5b4280f9fae058cf88879b5343f61853ab0d,
    );
    expect(cpu.getRomWord(0)).toEqual(0);
    expect(cpu.getRomWord(1023)).toEqual(0);
    expect(cpu.getStaticCommitment()).toEqual(staticCommitmentForRom(zeroRomRoot()));
    expect(cpu.getRomRootHash()).toEqual(zeroRomRoot().hash());
}

