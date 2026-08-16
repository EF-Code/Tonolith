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

get fun `test named failure paths and halted rejection`() {
    val deployer = testing.treasury("failure-deployer");

    val unknownCpu = TonolithCpu.fromStorage(makeStorage(zeroRomRoot()));
    expect(unknownCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: unknownCpu.address,
    });
    val unknown = unknownCpu.sendAny(
        deployer.address,
        beginCell().storeUint(0x999, 32).endCell(),
        { value: ton("0.1") },
    );
    expect(unknown).toHaveFailedTx({
        from: deployer.address,
        to: unknownCpu.address,
        exitCode: Errors.UnknownMessage,
    });
    val short = unknownCpu.sendAny(
        deployer.address,
        beginCell().storeUint(1, 8).endCell(),
        { value: ton("0.1") },
    );
    expect(short).toHaveFailedTx({
        from: deployer.address,
        to: unknownCpu.address,
        exitCode: Errors.UnknownMessage,
    });
    val empty = unknownCpu.sendAny(deployer.address, createEmptyCell(), { value: ton("0.1") });
    expect(empty).toHaveSuccessfulTx();

    val malformedAdvanceBody = beginCell()
        .storeUint(0x544E4C01, 32)
        .storeUint(0, 64)
        .storeUint(0, 64)
        .storeUint(unknownCpu.getCoreStateHash(), 256)
        .storeUint(1, 16)
        .storeUint(1, 1)
        .endCell();
    val malformedAdvance = unknownCpu.sendAny(
        deployer.address,
        malformedAdvanceBody,
        { value: ton("0.1") },
    );
    expect(malformedAdvance).toHaveFailedTx({
        from: deployer.address,
        to: unknownCpu.address,
        exitCode: 9,
    });

    val malformedTopUp = unknownCpu.sendAny(
        deployer.address,
        beginCell().storeUint(0x544E4C02, 32).storeUint(1, 1).endCell(),
        { value: ton("0.1") },
    );
    expect(malformedTopUp).toHaveFailedTx({
        from: deployer.address,
        to: unknownCpu.address,
        exitCode: 9,
    });

    val insufficientCpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0x1000)));
    expect(insufficientCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: insufficientCpu.address,
    });
    val insufficient = insufficientCpu.sendAdvance(
        deployer.address,
        0,
        0,
        insufficientCpu.getCoreStateHash(),
        1,
        { value: ton("0.001") },
    );
    expect(insufficient).toHaveFailedTx({
        from: deployer.address,
        to: insufficientCpu.address,
        exitCode: Errors.InsufficientValue,
    });
    val exactMinimum = insufficientCpu.sendAdvance(
        deployer.address,
        1,
        0,
        insufficientCpu.getCoreStateHash(),
        1,
        { value: ton("0.01") },
    );
    expect(exactMinimum).toHaveSuccessfulTx<Advance>();

    val zeroSteps = insufficientCpu.sendAdvance(
        deployer.address,
        2,
        insufficientCpu.getAdvanceCount(),
        insufficientCpu.getCoreStateHash(),
        0,
        { value: ton("0.1") },
    );
    expect(zeroSteps).toHaveFailedTx({
        from: deployer.address,
        to: insufficientCpu.address,
        exitCode: Errors.InvalidStepCount,
    });

    val nonCanonicalCpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0x1010)));
    expect(nonCanonicalCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: nonCanonicalCpu.address,
    });
    val nonCanonical = nonCanonicalCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonical).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalNopCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0x0001)),
    );
    expect(
        nonCanonicalNopCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalNopCpu.address });
    val nonCanonicalNop = nonCanonicalNopCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalNopCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalNop).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalNopCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalRegisterCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0x2010)),
    );
    expect(
        nonCanonicalRegisterCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalRegisterCpu.address });
    val nonCanonicalRegister = nonCanonicalRegisterCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalRegisterCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalRegister).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalRegisterCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalRamCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0xA100)),
    );
    expect(
        nonCanonicalRamCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalRamCpu.address });
    val nonCanonicalRam = nonCanonicalRamCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalRamCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalRam).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalRamCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalJumpCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0xC400)),
    );
    expect(
        nonCanonicalJumpCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalJumpCpu.address });
    val nonCanonicalJump = nonCanonicalJumpCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalJumpCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalJump).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalJumpCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalSysCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0xF010)),
    );
    expect(
        nonCanonicalSysCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalSysCpu.address });
    val nonCanonicalSys = nonCanonicalSysCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalSysCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalSys).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalSysCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalStoreCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0xB100)),
    );
    expect(
        nonCanonicalStoreCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalStoreCpu.address });
    val nonCanonicalStore = nonCanonicalStoreCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalStoreCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalStore).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalStoreCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalXorCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0x9010)),
    );
    expect(
        nonCanonicalXorCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalXorCpu.address });
    val nonCanonicalXor = nonCanonicalXorCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalXorCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalXor).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalXorCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val nonCanonicalJcCpu = TonolithCpu.fromStorage(
        makeStorage(romWithFirstWord(0xE400)),
    );
    expect(
        nonCanonicalJcCpu.deploy(deployer.address, { value: ton("1") }),
    ).toHaveSuccessfulDeploy({ to: nonCanonicalJcCpu.address });
    val nonCanonicalJc = nonCanonicalJcCpu.sendAdvance(
        deployer.address,
        0,
        0,
        nonCanonicalJcCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(nonCanonicalJc).toHaveFailedTx({
        from: deployer.address,
        to: nonCanonicalJcCpu.address,
        exitCode: Errors.NonCanonicalInstruction,
    });

    val invalidSysCpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0xF009)));
    expect(invalidSysCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidSysCpu.address,
    });
    val invalidSys = invalidSysCpu.sendAdvance(
        deployer.address,
        0,
        0,
        invalidSysCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(invalidSys).toHaveFailedTx({
        from: deployer.address,
        to: invalidSysCpu.address,
        exitCode: Errors.InvalidSysSubop,
    });

    val haltedCpu = TonolithCpu.fromStorage(makeStorage(romWithFirstWord(0xF000)));
    expect(haltedCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: haltedCpu.address,
    });
    val halt = haltedCpu.sendAdvance(
        deployer.address,
        0,
        0,
        haltedCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(halt).toHaveSuccessfulTx<Advance>();
    val afterHalt = haltedCpu.sendAdvance(
        deployer.address,
        1,
        haltedCpu.getAdvanceCount(),
        haltedCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(afterHalt).toHaveFailedTx({
        from: deployer.address,
        to: haltedCpu.address,
        exitCode: Errors.Halted,
    });

    var invalidStorage = makeStorage(zeroRomRoot());
    invalidStorage.magic = 0;
    val invalidStorageCpu = TonolithCpu.fromStorage(invalidStorage);
    expect(invalidStorageCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidStorageCpu.address,
    });
    val invalidStorageAdvance = invalidStorageCpu.sendAdvance(
        deployer.address,
        0,
        0,
        invalidStorageCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(invalidStorageAdvance).toHaveFailedTx({
        from: deployer.address,
        to: invalidStorageCpu.address,
        exitCode: Errors.InvalidStorage,
    });

    var invalidSchema = makeStorage(zeroRomRoot());
    invalidSchema.schemaVersion = 2;
    val invalidSchemaCpu = TonolithCpu.fromStorage(invalidSchema);
    expect(invalidSchemaCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidSchemaCpu.address,
    });
    val invalidSchemaAdvance = invalidSchemaCpu.sendAdvance(
        deployer.address,
        0,
        0,
        invalidSchemaCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(invalidSchemaAdvance).toHaveFailedTx({
        from: deployer.address,
        to: invalidSchemaCpu.address,
        exitCode: Errors.InvalidStorage,
    });

    var invalidIsa = makeStorage(zeroRomRoot());
    invalidIsa.isaVersion = 2;
    val invalidIsaCpu = TonolithCpu.fromStorage(invalidIsa);
    expect(invalidIsaCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidIsaCpu.address,
    });
    val invalidIsaAdvance = invalidIsaCpu.sendAdvance(
        deployer.address,
        0,
        0,
        invalidIsaCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(invalidIsaAdvance).toHaveFailedTx({
        from: deployer.address,
        to: invalidIsaCpu.address,
        exitCode: Errors.InvalidStorage,
    });

    var invalidStatic = makeStorage(zeroRomRoot());
    invalidStatic.staticCommitment = 0;
    val invalidStaticCpu = TonolithCpu.fromStorage(invalidStatic);
    expect(invalidStaticCpu.deploy(deployer.address, { value: ton("1") })).toHaveSuccessfulDeploy({
        to: invalidStaticCpu.address,
    });
    val invalidStaticAdvance = invalidStaticCpu.sendAdvance(
        deployer.address,
        0,
        0,
        invalidStaticCpu.getCoreStateHash(),
        1,
        { value: ton("0.1") },
    );
    expect(invalidStaticAdvance).toHaveFailedTx({
        from: deployer.address,
        to: invalidStaticCpu.address,
        exitCode: Errors.InvalidStorage,
    });
}

get fun `test defensive selectors reject out of range indexes`() {
    val level2 = zeroRomLevel2().load();
    val ram = zeroRamRoot().load();

    val distinctLevel1 = RomLevel1 {
        leaf0: RomLeaf {
            firstHalf: 1,
            secondHalf: 0,
        }.toCell(),
        leaf1: RomLeaf {
            firstHalf: 2,
            secondHalf: 0,
        }.toCell(),
        leaf2: RomLeaf {
            firstHalf: 3,
            secondHalf: 0,
        }.toCell(),
        leaf3: RomLeaf {
            firstHalf: 4,
            secondHalf: 0,
        }.toCell(),
    }.toCell();
    val distinctLevel2 = RomLevel2 {
        level10: distinctLevel1,
        level11: RomLevel1 {
            leaf0: RomLeaf {
                firstHalf: 5,
                secondHalf: 0,
            }.toCell(),
            leaf1: RomLeaf {
                firstHalf: 6,
                secondHalf: 0,
            }.toCell(),
            leaf2: RomLeaf {
                firstHalf: 7,
                secondHalf: 0,
            }.toCell(),
            leaf3: RomLeaf {
                firstHalf: 8,
                secondHalf: 0,
            }.toCell(),
        }.toCell(),
        level12: RomLevel1 {
            leaf0: RomLeaf {
                firstHalf: 9,
                secondHalf: 0,
            }.toCell(),
            leaf1: RomLeaf {
                firstHalf: 10,
                secondHalf: 0,
            }.toCell(),
            leaf2: RomLeaf {
                firstHalf: 11,
                secondHalf: 0,
            }.toCell(),
            leaf3: RomLeaf {
                firstHalf: 12,
                secondHalf: 0,
            }.toCell(),
        }.toCell(),
        level13: RomLevel1 {
            leaf0: RomLeaf {
                firstHalf: 13,
                secondHalf: 0,
            }.toCell(),
            leaf1: RomLeaf {
                firstHalf: 14,
                secondHalf: 0,
            }.toCell(),
            leaf2: RomLeaf {
                firstHalf: 15,
                secondHalf: 0,
            }.toCell(),
            leaf3: RomLeaf {
                firstHalf: 16,
                secondHalf: 0,
            }.toCell(),
        }.toCell(),
    }.toCell()
        .load();
    expect(selectRomLevel1(distinctLevel2, 0).toCell().hash()).toEqual(
        distinctLevel2.level10.hash(),
    );
    expect(selectRomLevel1(distinctLevel2, 1).toCell().hash()).toEqual(
        distinctLevel2.level11.hash(),
    );
    expect(selectRomLevel1(distinctLevel2, 2).toCell().hash()).toEqual(
        distinctLevel2.level12.hash(),
    );
    expect(selectRomLevel1(distinctLevel2, 3).toCell().hash()).toEqual(
        distinctLevel2.level13.hash(),
    );

    val distinctRam = RamRoot {
        page0: RamPage { packed: 1 }.toCell(),
        page1: RamPage { packed: 2 }.toCell(),
        page2: RamPage { packed: 3 }.toCell(),
        page3: RamPage { packed: 4 }.toCell(),
    }.toCell()
        .load();
    expect(selectRamPage(distinctRam, 0).hash()).toEqual(distinctRam.page0.hash());
    expect(selectRamPage(distinctRam, 1).hash()).toEqual(distinctRam.page1.hash());
    expect(selectRamPage(distinctRam, 2).hash()).toEqual(distinctRam.page2.hash());
    expect(selectRamPage(distinctRam, 3).hash()).toEqual(distinctRam.page3.hash());

    var caughtLevel1 = false;
    try {
        val _ignored = selectRomLevel1(level2, 4);
    } catch (e) {
        caughtLevel1 = true;
        expect(e).toEqual(108);
    }
    expect(caughtLevel1).toEqual(true);

    var caughtPage = false;
    try {
        val _ignored = selectRamPage(ram, 4);
    } catch (e) {
        caughtPage = true;
        expect(e).toEqual(108);
    }
    expect(caughtPage).toEqual(true);
}

@test.fuzz({ runs: 256, seed: 42 })
