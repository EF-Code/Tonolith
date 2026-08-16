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

get fun `test stale and invalid advance requests do not mutate state`() {
    val deployer = testing.treasury("stale-deployer");
    val cpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0x0000)));
    val deploy = cpu.deploy(deployer.address, { value: ton("1") });
    expect(deploy).toHaveSuccessfulDeploy({ to: cpu.address });

    val initialHash = cpu.getCoreStateHash();
    val first = cpu.sendAdvance(
        deployer.address,
        1,
        0,
        initialHash,
        1,
        { value: ton("0.1") },
    );
    expect(first).toHaveSuccessfulTx<Advance>();
    val advancedHash = cpu.getCoreStateHash();

    val stale = cpu.sendAdvance(
        deployer.address,
        2,
        0,
        initialHash,
        1,
        { value: ton("0.1") },
    );
    expect(stale).toHaveFailedTx({
        from: deployer.address,
        to: cpu.address,
        exitCode: Errors.StaleAdvance,
    });
    expect(cpu.getCoreStateHash()).toEqual(advancedHash);

    val wrongHash = cpu.sendAdvance(
        deployer.address,
        3,
        1,
        0,
        1,
        { value: ton("0.1") },
    );
    expect(wrongHash).toHaveFailedTx({
        from: deployer.address,
        to: cpu.address,
        exitCode: Errors.StateHashMismatch,
    });

    val invalidSteps = cpu.sendAdvance(
        deployer.address,
        4,
        1,
        advancedHash,
        2,
        { value: ton("0.1") },
    );
    expect(invalidSteps).toHaveFailedTx({
        from: deployer.address,
        to: cpu.address,
        exitCode: Errors.InvalidStepCount,
    });
    expect(cpu.getCoreStateHash()).toEqual(advancedHash);
}

get fun `test arithmetic logical and SYS opcodes`() {
    val deployer = testing.treasury("opcode-deployer");
    val cpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
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
            ),
        ),
    );
    expect(
        cpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: cpu.address });

    repeat (16) {
        advanceOne(cpu, deployer.address, cpu.getAdvanceCount());
    }

    expect(cpu.getInstructionCount()).toEqual(16);
    expect(cpu.getAdvanceCount()).toEqual(16);
    expect(cpu.getPc()).toEqual(16);
    expect(cpu.getAccumulator()).toEqual(7);
    expect(cpu.getFlags()).toEqual(2);
    expect(cpu.getRegisters()).toEqual(15);
}

get fun `test register load jump and ADC without carry`() {
    val deployer = testing.treasury("register-jump-deployer");
    val cpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x100A,
                0x300F,
                0x200F,
                0xC005,
                0x1000,
                0xE007,
                0x0000,
                0xF000,
                0x0000,
                0x0000,
                0x0000,
                0x0000,
                0x0000,
                0x0000,
                0x0000,
                0x0000,
            ),
        ),
    );
    expect(cpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: cpu.address,
    });
    while (cpu.getStatus() == 0) {
        advanceOne(cpu, deployer.address, cpu.getAdvanceCount());
    }
    expect(cpu.getAccumulator()).toEqual(10);
    expect(cpu.getRegisters()).toEqual(10 << (15 * 4));
    expect(cpu.getPc()).toEqual(8);

    val adcCpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x1001,
                0x5000,
                0xF000,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ),
        ),
    );
    expect(adcCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: adcCpu.address,
    });
    while (adcCpu.getStatus() == 0) {
        advanceOne(adcCpu, deployer.address, adcCpu.getAdvanceCount());
    }
    expect(adcCpu.getAccumulator()).toEqual(1);
    expect(adcCpu.getFlags()).toEqual(0);
}

get fun `test arithmetic and flag boundary outcomes`() {
    val deployer = testing.treasury("arithmetic-boundary-deployer");
    val cpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x1001,
                0x3000,
                0xF003,
                0x4000,
                0x1002,
                0x3001,
                0xF003,
                0x5001,
                0x6001,
                0xF002,
                0x7000,
                0xF005,
                0xF006,
                0x100F,
                0xF007,
                0xF000,
            ),
        ),
    );
    expect(cpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: cpu.address,
    });

    advanceOne(cpu, deployer.address, 0);
    advanceOne(cpu, deployer.address, 1);
    advanceOne(cpu, deployer.address, 2);
    advanceOne(cpu, deployer.address, 3);
    expect(cpu.getAccumulator()).toEqual(2);
    expect(cpu.getFlags()).toEqual(0);

    advanceOne(cpu, deployer.address, 4);
    advanceOne(cpu, deployer.address, 5);
    advanceOne(cpu, deployer.address, 6);
    advanceOne(cpu, deployer.address, 7);
    expect(cpu.getAccumulator()).toEqual(5);

    advanceOne(cpu, deployer.address, 8);
    expect(cpu.getAccumulator()).toEqual(3);
    expect(cpu.getFlags()).toEqual(2);

    advanceOne(cpu, deployer.address, 9);
    expect(cpu.getFlags()).toEqual(0);
    advanceOne(cpu, deployer.address, 10);
    expect(cpu.getAccumulator()).toEqual(1);
    expect(cpu.getFlags()).toEqual(0);
    advanceOne(cpu, deployer.address, 11);
    expect(cpu.getAccumulator()).toEqual(2);
    expect(cpu.getFlags()).toEqual(0);
    advanceOne(cpu, deployer.address, 12);
    expect(cpu.getAccumulator()).toEqual(1);
    expect(cpu.getFlags()).toEqual(0);
    advanceOne(cpu, deployer.address, 13);
    advanceOne(cpu, deployer.address, 14);
    expect(cpu.getAccumulator()).toEqual(0);
    expect(cpu.getFlags()).toEqual(3);
}

get fun `test exact arithmetic carry and subtraction boundaries`() {
    var addCore = initialCore().load();
    executeInstruction(mutate addCore, 0x100F);
    executeInstruction(mutate addCore, 0x3000);
    executeInstruction(mutate addCore, 0x1001);
    executeInstruction(mutate addCore, 0x4000);
    expect(addCore.accumulator).toEqual(0);
    expect(addCore.flags).toEqual(3);

    var subtractCore = initialCore().load();
    executeInstruction(mutate subtractCore, 0x1007);
    executeInstruction(mutate subtractCore, 0x3000);
    executeInstruction(mutate subtractCore, 0x2000);
    executeInstruction(mutate subtractCore, 0x6000);
    expect(subtractCore.accumulator).toEqual(0);
    expect(subtractCore.flags).toEqual(3);

    val deployer = testing.treasury("exact-arithmetic-contract-deployer");
    val addCpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x100F,
                0x3000,
                0x1001,
                0x4000,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ),
        ),
    );
    expect(addCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: addCpu.address,
    });
    repeat (4) {
        advanceOne(addCpu, deployer.address, addCpu.getAdvanceCount());
    }
    expect(addCpu.getAccumulator()).toEqual(0);
    expect(addCpu.getFlags()).toEqual(3);

    val subtractCpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x1007,
                0x3000,
                0x2000,
                0x6000,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ),
        ),
    );
    expect(subtractCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: subtractCpu.address,
    });
    repeat (4) {
        advanceOne(subtractCpu, deployer.address, subtractCpu.getAdvanceCount());
    }
    expect(subtractCpu.getAccumulator()).toEqual(0);
    expect(subtractCpu.getFlags()).toEqual(3);
}

get fun `test JC false path and maximum jump target`() {
    val deployer = testing.treasury("jump-boundary-deployer");
    val cpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0xE003,
                0xF000,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0xF000,
                0,
                0,
                0,
                0,
                0,
            ),
        ),
    );
    expect(cpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: cpu.address,
    });
    advanceOne(cpu, deployer.address, 0);
    expect(cpu.getPc()).toEqual(1);
    advanceOne(cpu, deployer.address, 1);
    expect(cpu.getStatus()).toEqual(1);
    expect(cpu.getPc()).toEqual(2);

    val maxTargetCpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0xC3FF)));
    expect(maxTargetCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: maxTargetCpu.address,
    });
    advanceOne(maxTargetCpu, deployer.address, 0);
    expect(maxTargetCpu.getPc()).toEqual(1023);
}

get fun `test INC sets carry and zero on nibble wrap`() {
    val deployer = testing.treasury("inc-boundary-deployer");
    val cpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x100F,
                0xF007,
                0xF000,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ),
        ),
    );
    expect(cpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: cpu.address,
    });
    repeat (3) {
        advanceOne(cpu, deployer.address, cpu.getAdvanceCount());
    }
    expect(cpu.getAccumulator()).toEqual(0);
    expect(cpu.getFlags()).toEqual(3);
}

get fun `test RAM and branch opcodes`() {
    val deployer = testing.treasury("memory-deployer");
    val cpu = TonolithCpu.fromStorage(
        makeStorage(
            romWithWords(
                0x100A,
                0xB0FF,
                0x1000,
                0xD005,
                0x100F,
                0xA0FF,
                0xD008,
                0xF003,
                0xE00B,
                0x100D,
                0xF002,
                0xE00E,
                0xC00F,
                0x100E,
                0x0000,
                0xF000,
            ),
        ),
    );
    expect(
        cpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: cpu.address });

    while (cpu.getStatus() == 0) {
        advanceOne(cpu, deployer.address, cpu.getAdvanceCount());
    }

    expect(cpu.getRamNibble(0xFF)).toEqual(10);
    expect(cpu.getAccumulator()).toEqual(10);
    expect(cpu.getPc()).toEqual(16);
    expect(cpu.getStatus()).toEqual(1);
    expect(cpu.getInstructionCount()).toEqual(11);
    expect(cpu.getAdvanceCount()).toEqual(11);
}

