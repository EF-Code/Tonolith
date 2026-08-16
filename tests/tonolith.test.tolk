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

get fun `test top up message preserves metadata`() {
    val deployer = testing.treasury("deployer");
    val cpu = TonolithCpu.fromStorage(makeStorage(zeroRomRoot()));
    val deploy = cpu.deploy(deployer.address, { value: ton("1") });
    expect(deploy).toHaveSuccessfulDeploy({ to: cpu.address });

    val res = cpu.sendTopUp(deployer.address, { value: ton("0.1") });
    expect(res).toHaveSuccessfulTx<TopUp>({
        from: deployer.address,
        to: cpu.address,
    });

    expect(cpu.getMagic()).toEqual(0x544E4C31);
}

get fun `test advance executes one instruction and emits commitments`() {
    val deployer = testing.treasury("advance-deployer");
    val cpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0x1001)));
    val deploy = cpu.deploy(deployer.address, { value: ton("1") });
    expect(deploy).toHaveSuccessfulDeploy({ to: cpu.address });

    val initialHash = cpu.getCoreStateHash();
    val res = cpu.sendAdvance(
        deployer.address,
        7,
        0,
        initialHash,
        1,
        { value: ton("0.1") },
    );
    expect(res).toHaveSuccessfulTx<Advance>({
        from: deployer.address,
        to: cpu.address,
    });
    expect(res).toEmitExternalMessage<CpuAdvanced>();
    val event = res.findExternalOutMessage<CpuAdvanced>({ from: cpu.address });
    expect(event).toBeNotNull();
    expect(event!.loadBody()).toEqual(CpuAdvanced {
        queryId: 7,
        advanceCount: 1,
        startInstruction: 0,
        endInstruction: 1,
        previousStateHash: initialHash,
        nextStateHash: 0x52c028f35072f3210e182bc2a4ca99f7e3965868c49deca6b635082cf5fc4396,
        finalPc: 1,
        status: 0,
    });
    expect(cpu.getCoreStateHash()).toEqual(
        0x52c028f35072f3210e182bc2a4ca99f7e3965868c49deca6b635082cf5fc4396,
    );
    expect(cpu.getRomWord(0)).toEqual(0x1001);

    val actions = res.at(0).allOutActions();
    val refund = actions.getSendMessageAt(0);
    expect(refund).toBeNotNull();
    expect(refund!.mode).toEqual(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
    val refundMessage = refund!.loadGenericMessage();
    expect(refundMessage.info.dest).toEqual(deployer.address);
}

