import assert from "node:assert/strict";
import test from "node:test";
import { assemble } from "../../tools/assembler/assembler.js";
import { encodeInstruction, encodePortInstruction, encodeTrap } from "../../packages/isa/src/codec.js";
import { Opcode } from "../../packages/isa/src/types.js";
import { STATUS, STOP_REASON, SYS } from "../../packages/isa/src/constants.js";
import {
  acknowledgeOutput,
  advance,
  deliverInput,
  dispatchOutput,
  step,
  type DeliverInputMessage,
} from "../../packages/emulator/src/executor.js";
import { outputId, stateHash } from "../../packages/emulator/src/commitments.js";
import { createInitialState, type CoreConfig, type OutputRecord } from "../../packages/emulator/src/model.js";

const RUN_ID = "11".repeat(32);

function config(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    runId: RUN_ID,
    coreId: 0,
    programId: "22".repeat(32),
    romRoot: "33".repeat(32),
    initialRamRoot: "44".repeat(32),
    routeRoot: "55".repeat(32),
    staticCommitment: "66".repeat(32),
    routes: [],
    requiredInputs: [],
    maxStepsPerAdvance: 1,
    ...overrides,
  };
}

function rom(...words: number[]): number[] {
  return [...words, ...Array.from({ length: 1024 - words.length }, () => 0)];
}

function inputMessage(overrides: Partial<DeliverInputMessage> = {}): DeliverInputMessage {
  const fields = {
    runId: RUN_ID,
    sourceCoreId: 1,
    destinationCoreId: 0,
    sourceEpoch: 0n,
    destinationEpoch: 1n,
    sourcePort: 0,
    destinationPort: 0,
    sequence: 0,
    value: 7,
    sourceInstructionCount: 1n,
    sourceStateHash: "aa".repeat(32),
    ...overrides,
  };
  return {
    ...fields,
    outputId: outputId(fields.runId, fields),
  };
}

test("v2 executes every inherited opcode with v1 arithmetic and flag semantics", () => {
  const cases: Array<{ name: string; word: number; prepare?: (state: ReturnType<typeof createInitialState>) => void; check: (state: ReturnType<typeof createInitialState>) => void }> = [
    { name: "NOP", word: encodeInstruction(Opcode.NOP), check: (state) => assert.equal(state.pc, 1) },
    { name: "LDI", word: encodeInstruction(Opcode.LDI, 9), check: (state) => assert.equal(state.accumulator, 9) },
    { name: "LDR", word: encodeInstruction(Opcode.LDR, 2), prepare: (state) => { state.registers[2] = 8; }, check: (state) => assert.equal(state.accumulator, 8) },
    { name: "STR", word: encodeInstruction(Opcode.STR, 2), prepare: (state) => { state.accumulator = 8; }, check: (state) => assert.equal(state.registers[2], 8) },
    { name: "ADD", word: encodeInstruction(Opcode.ADD, 2), prepare: (state) => { state.accumulator = 8; state.registers[2] = 9; }, check: (state) => { assert.equal(state.accumulator, 1); assert.equal(state.flags & 2, 2); } },
    { name: "ADC", word: encodeInstruction(Opcode.ADC, 2), prepare: (state) => { state.accumulator = 8; state.registers[2] = 7; state.flags = 2; }, check: (state) => { assert.equal(state.accumulator, 0); assert.equal(state.flags & 3, 3); } },
    { name: "SUB", word: encodeInstruction(Opcode.SUB, 2), prepare: (state) => { state.accumulator = 2; state.registers[2] = 3; }, check: (state) => { assert.equal(state.accumulator, 15); assert.equal(state.flags & 2, 0); } },
    { name: "AND", word: encodeInstruction(Opcode.AND, 2), prepare: (state) => { state.accumulator = 0xc; state.registers[2] = 0xa; }, check: (state) => assert.equal(state.accumulator, 8) },
    { name: "OR", word: encodeInstruction(Opcode.OR, 2), prepare: (state) => { state.accumulator = 0xc; state.registers[2] = 0x3; }, check: (state) => assert.equal(state.accumulator, 15) },
    { name: "XOR", word: encodeInstruction(Opcode.XOR, 2), prepare: (state) => { state.accumulator = 0xc; state.registers[2] = 0xa; }, check: (state) => assert.equal(state.accumulator, 6) },
    { name: "LDM", word: encodeInstruction(Opcode.LDM, 7), prepare: (state) => { state.ram[7] = 6; }, check: (state) => assert.equal(state.accumulator, 6) },
    { name: "STM", word: encodeInstruction(Opcode.STM, 7), prepare: (state) => { state.accumulator = 6; }, check: (state) => assert.equal(state.ram[7], 6) },
    { name: "JMP", word: encodeInstruction(Opcode.JMP, 8), check: (state) => assert.equal(state.pc, 8) },
    { name: "JZ", word: encodeInstruction(Opcode.JZ, 8), prepare: (state) => { state.flags = 1; }, check: (state) => assert.equal(state.pc, 8) },
    { name: "JC", word: encodeInstruction(Opcode.JC, 8), prepare: (state) => { state.flags = 2; }, check: (state) => assert.equal(state.pc, 8) },
    { name: "CLC", word: encodeInstruction(Opcode.SYS, SYS.CLC), prepare: (state) => { state.flags = 2; }, check: (state) => assert.equal(state.flags & 2, 0) },
    { name: "STC", word: encodeInstruction(Opcode.SYS, SYS.STC), check: (state) => assert.equal(state.flags & 2, 2) },
    { name: "NOT", word: encodeInstruction(Opcode.SYS, SYS.NOT), prepare: (state) => { state.accumulator = 5; }, check: (state) => assert.equal(state.accumulator, 10) },
    { name: "SHL", word: encodeInstruction(Opcode.SYS, SYS.SHL), prepare: (state) => { state.accumulator = 9; }, check: (state) => { assert.equal(state.accumulator, 2); assert.equal(state.flags & 2, 2); } },
    { name: "SHR", word: encodeInstruction(Opcode.SYS, SYS.SHR), prepare: (state) => { state.accumulator = 9; }, check: (state) => { assert.equal(state.accumulator, 4); assert.equal(state.flags & 2, 2); } },
    { name: "INC", word: encodeInstruction(Opcode.SYS, SYS.INC), prepare: (state) => { state.accumulator = 15; }, check: (state) => { assert.equal(state.accumulator, 0); assert.equal(state.flags & 3, 3); } },
    { name: "DEC", word: encodeInstruction(Opcode.SYS, SYS.DEC), prepare: (state) => { state.accumulator = 0; }, check: (state) => { assert.equal(state.accumulator, 15); assert.equal(state.flags & 2, 0); } },
  ];

  for (const testCase of cases) {
    const state = createInitialState(config());
    testCase.prepare?.(state);
    const result = step(state, { rom: rom(testCase.word) });
    assert.equal(result.executed, true, testCase.name);
    assert.equal(result.state.instructionCount, 1n, testCase.name);
    testCase.check(result.state);
  }
});

test("IN waits without consuming a step and then consumes the lowest ordered input", () => {
  const destination = createInitialState(config({
    routes: [{ sourceCoreId: 1, sourcePort: 0, destinationCoreId: 0, destinationPort: 3, delay: 1, maxRecordsPerEpoch: 4 }],
  }));
  destination.epoch = 1n;
  const waiting = step(destination, { rom: rom(encodePortInstruction(SYS.IN, 3)) });
  assert.equal(waiting.executed, false);
  assert.equal(waiting.stopReason, STOP_REASON.inputUnavailable);
  assert.equal(waiting.state.status, STATUS.waitingInput);
  assert.equal(waiting.state.pc, 0);
  assert.equal(waiting.state.instructionCount, 0n);

  const delivered = deliverInput(waiting.state, inputMessage({ destinationEpoch: 1n, destinationPort: 3, value: 12 }));
  assert.equal(delivered.duplicate, false);
  const consumed = step(delivered.state, { rom: rom(encodePortInstruction(SYS.IN, 3)) });
  assert.equal(consumed.executed, true);
  assert.equal(consumed.state.accumulator, 12);
  assert.equal(consumed.state.inbox[0]?.consumed, true);
  assert.equal(consumed.state.instructionCount, 1n);
});

test("OUTP creates a routed pending record and backpressure leaves PC untouched", () => {
  const state = createInitialState(config({
    routes: [{ sourceCoreId: 0, sourcePort: 2, destinationCoreId: 1, destinationPort: 4, delay: 1, maxRecordsPerEpoch: 4 }],
    maxOutputRecords: 1,
  }));
  state.accumulator = 11;
  const produced = step(state, { rom: rom(encodePortInstruction(SYS.OUTP, 2)) });
  assert.equal(produced.executed, true);
  assert.equal(produced.output?.value, 11);
  assert.equal(produced.output?.destinationEpoch, 1n);
  assert.equal(produced.state.outbox.length, 1);

  const full = produced.state;
  full.pc = 0;
  const blocked = step(full, { rom: rom(encodePortInstruction(SYS.OUTP, 2)) });
  assert.equal(blocked.executed, false);
  assert.equal(blocked.stopReason, STOP_REASON.outputBackpressure);
  assert.equal(blocked.state.status, STATUS.backpressured);
  assert.equal(blocked.state.pc, 0);
  assert.equal(blocked.state.instructionCount, 1n);
});

test("YIELD closes an epoch, TRAP is architectural, and acknowledgement wakes backpressure", () => {
  const yieldedState = createInitialState(config({
    requiredInputs: [{ port: 1, count: 1 }],
    routes: [{ sourceCoreId: 1, sourcePort: 0, destinationCoreId: 0, destinationPort: 1, delay: 1, maxRecordsPerEpoch: 4 }],
  }));
  const yielded = step(yieldedState, { rom: rom(encodeInstruction(Opcode.SYS, SYS.YIELD)) });
  assert.equal(yielded.executed, true);
  assert.equal(yielded.stopReason, STOP_REASON.yielded);
  assert.equal(yielded.state.epoch, 1n);
  assert.equal(yielded.state.status, STATUS.waitingInput);
  const awakened = deliverInput(yielded.state, inputMessage({ destinationEpoch: 1n, destinationPort: 1 }));
  assert.equal(awakened.state.status, STATUS.running);

  const trapped = step(createInitialState(config()), { rom: rom(encodeTrap(0xab)) });
  assert.equal(trapped.state.status, STATUS.faulted);
  assert.equal(trapped.state.faultCode, 0xab);
  assert.equal(trapped.stopReason, STOP_REASON.faulted);

  const routed = createInitialState(config({
    routes: [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 }],
  }));
  const output = step(routed, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }).output;
  assert.ok(output);
  const full = { ...routed, outbox: [output], pc: 0, status: STATUS.backpressured };
  const acknowledged = acknowledgeOutput(full, {
    runId: RUN_ID,
    outputId: output.outputId,
    destinationCoreId: 1,
    destinationEpoch: output.destinationEpoch,
    destinationStateHash: "bb".repeat(32),
  });
  assert.equal(acknowledged.duplicate, false);
  assert.equal(acknowledged.state.outbox.length, 0);
  assert.equal(acknowledged.state.status, STATUS.running);
});

test("batched execution is equivalent to repeated single steps except protocol counters", () => {
  const words = assemble("LDI 1\nINC\nOUT\nHALT\n").words;
  const initial = createInitialState(config({ maxStepsPerAdvance: 4 }));
  const batched = advance(initial, { rom: rom(...words) }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: stateHash(initial),
    maxInstructions: 4,
    maxOutputs: 16,
  });
  let repeated = initial;
  const outputs: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const result = step(repeated, { rom: rom(...words) });
    repeated = result.state;
    if (result.legacyOutput !== undefined) outputs.push(result.legacyOutput.value);
  }
  assert.deepEqual(outputs, [2]);
  assert.equal(batched.executed, 4);
  assert.equal(batched.stopReason, STOP_REASON.halted);
  assert.deepEqual({ pc: batched.state.pc, accumulator: batched.state.accumulator, flags: batched.state.flags, status: batched.state.status, instructionCount: batched.state.instructionCount, outputCount: batched.state.outputCount, outputCommitment: batched.state.outputCommitment }, { pc: repeated.pc, accumulator: repeated.accumulator, flags: repeated.flags, status: repeated.status, instructionCount: repeated.instructionCount, outputCount: repeated.outputCount, outputCommitment: repeated.outputCommitment });
});

test("stale and racing advances fail before architectural mutation", () => {
  const initial = createInitialState(config());
  const expected = stateHash(initial);
  assert.throws(() => advance(initial, { rom: rom(encodeInstruction(Opcode.NOP)) }, {
    expectedAdvanceCount: 1n,
    expectedStateHash: expected,
    maxInstructions: 1,
    maxOutputs: 1,
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "STALE_ADVANCE");
  assert.equal(stateHash(initial), expected);

  const accepted = advance(initial, { rom: rom(encodeInstruction(Opcode.NOP)) }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: expected,
    maxInstructions: 1,
    maxOutputs: 1,
  });
  assert.throws(() => advance(accepted.state, { rom: rom(encodeInstruction(Opcode.NOP)) }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: expected,
    maxInstructions: 1,
    maxOutputs: 1,
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "STALE_ADVANCE");
});

test("Fibonacci regression produces 1, 1, 2, 3, 5, 8, 13", () => {
  const words = assemble(`
    LDI 1
    STR R0
    LDI 1
    STR R1
    LDI 7
    STR R2
  LOOP:
    LDR R0
    OUT
    LDR R2
    DEC
    STR R2
    JZ DONE
    LDR R0
    ADD R1
    STR R3
    LDR R1
    STR R0
    LDR R3
    STR R1
    JMP LOOP
  DONE:
    HALT
  `).words;
  const initial = createInitialState(config());
  let current = initial;
  const outputs: number[] = [];
  for (let guard = 0; guard < 200 && current.status === STATUS.running; guard += 1) {
    const result = advance(current, { rom: rom(...words) }, {
      expectedAdvanceCount: current.advanceCount,
      expectedStateHash: stateHash(current),
      maxInstructions: 1,
      maxOutputs: 1,
    });
    current = result.state;
    outputs.push(...result.legacyOutputs.map((output) => output.value));
  }
  assert.deepEqual(outputs, [1, 1, 2, 3, 5, 8, 13]);
  assert.equal(current.status, STATUS.halted);
  assert.equal(current.instructionCount, 97n);
  assert.equal(current.advanceCount, 97n);
  assert.equal(current.outputCount, 7n);
});

test("dispatch reconstructs the authenticated input message and rejects stale state", () => {
  const state = createInitialState(config({
    routes: [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 }],
  }));
  const output = step(state, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }).output;
  assert.ok(output);
  const source = step(state, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }).state;
  const dispatched = dispatchOutput(source, { expectedStateHash: stateHash(source), outputId: output.outputId });
  assert.equal(dispatched.message.outputId, output.outputId);
  assert.equal(dispatched.message.destinationCoreId, 1);
  assert.throws(() => dispatchOutput(source, { expectedStateHash: stateHash(state), outputId: output.outputId }), /state hash/);
});

test("v2 emulator rejects invalid execution envelopes before mutation", () => {
  const halted = createInitialState(config());
  halted.status = STATUS.halted;
  assert.throws(() => step(halted, { rom: rom(0) }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_STATUS");

  assert.throws(() => step(createInitialState(config()), { rom: Array.from({ length: 1025 }, () => 0) }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_ROM");

  const missingWord = createInitialState(config());
  missingWord.pc = 1;
  assert.throws(() => step(missingWord, { rom: [] }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PC");

  assert.throws(() => step(createInitialState(config()), { rom: rom(0x0001) }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_INSTRUCTION");

  const initial = createInitialState(config({ maxStepsPerAdvance: 2 }));
  const hash = stateHash(initial);
  const request = (overrides: Partial<Parameters<typeof advance>[2]> = {}) => advance(initial, { rom: rom(0) }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: hash,
    maxInstructions: 1,
    maxOutputs: 1,
    ...overrides,
  });
  assert.throws(() => request({ maxInstructions: 0 }), /instruction batch/);
  assert.throws(() => request({ maxInstructions: 3 }), /instruction batch/);
  assert.throws(() => request({ maxOutputs: 0 }), /output event/);
  assert.throws(() => request({ maxOutputs: 17 }), /output event/);
  assert.throws(() => request({ expectedStateHash: "ff".repeat(32) }), /state hash/);

  const faulted = createInitialState(config());
  faulted.status = STATUS.faulted;
  assert.throws(() => advance(faulted, { rom: rom(0) }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: stateHash(faulted),
    maxInstructions: 1,
    maxOutputs: 1,
  }), /halted or faulted/);

  const outputLimit = advance(createInitialState(config({ maxStepsPerAdvance: 2 })), { rom: rom(encodeInstruction(Opcode.LDI, 2), encodeInstruction(Opcode.SYS, SYS.OUT)) }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: stateHash(createInitialState(config({ maxStepsPerAdvance: 2 }))),
    maxInstructions: 2,
    maxOutputs: 1,
  });
  assert.equal(outputLimit.stopReason, STOP_REASON.outputEventLimit);
  assert.equal(outputLimit.legacyOutputs[0]?.value, 2);
});

test("v2 emulator validates delivery identity, route, epoch, slot, and capacity boundaries", () => {
  const route = { sourceCoreId: 1, sourcePort: 0, destinationCoreId: 0, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 };
  const base = createInitialState(config({ routes: [route] }));

  const expectCode = (action: () => unknown, code: string) => {
    assert.throws(action, (error: unknown) => error instanceof Error && "code" in error && error.code === code);
  };
  expectCode(() => deliverInput(base, inputMessage({ runId: "bb".repeat(32) })), "INVALID_RUN");
  expectCode(() => deliverInput(base, inputMessage(), 2), "UNAUTHORIZED_PEER");
  expectCode(() => deliverInput(base, inputMessage({ destinationCoreId: 1 })), "UNAUTHORIZED_PEER");
  const oldEpoch = createInitialState(config({ routes: [route] }));
  oldEpoch.epoch = 1n;
  expectCode(() => deliverInput(oldEpoch, inputMessage({ destinationEpoch: 0n })), "INVALID_EPOCH");
  expectCode(() => deliverInput(oldEpoch, inputMessage({ sourceEpoch: 2n, destinationEpoch: 3n })), "INVALID_EPOCH");
  const canonicalMessage = inputMessage();
  expectCode(() => deliverInput(base, { ...canonicalMessage, sourcePort: 16 }), "INVALID_ROUTE");
  expectCode(() => deliverInput(base, { ...canonicalMessage, destinationPort: 16 }), "INVALID_ROUTE");
  expectCode(() => deliverInput(createInitialState(config()), inputMessage()), "INVALID_ROUTE");
  expectCode(() => deliverInput(createInitialState(config({ routes: [{ ...route, delay: 2 }] })), inputMessage()), "INVALID_ROUTE");
  expectCode(() => deliverInput(createInitialState(config({ routes: [{ ...route, maxRecordsPerEpoch: 1 }] })), inputMessage({ sequence: 1 })), "INVALID_ROUTE");
  expectCode(() => deliverInput(base, { ...inputMessage(), outputId: "ff".repeat(32) }), "INVALID_ROUTE");

  const first = deliverInput(base, inputMessage({ queryId: 7n }));
  const duplicate = deliverInput(first.state, inputMessage({ queryId: 8n }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.acknowledgement.queryId, 8n);

  const corrupt = createInitialState(config({ routes: [route] }));
  const canonical = inputMessage();
  corrupt.inbox.push({ ...canonical, value: 8, consumed: false });
  expectCode(() => deliverInput(corrupt, canonical), "CONFLICTING_REPLAY");

  const slotConflict = deliverInput(base, inputMessage());
  expectCode(() => deliverInput(slotConflict.state, inputMessage({ sourceStateHash: "bb".repeat(32) })), "CONFLICTING_REPLAY");

  const limited = createInitialState(config({ routes: [route], maxInputRecords: 1 }));
  const limitedFirst = deliverInput(limited, inputMessage());
  expectCode(() => deliverInput(limitedFirst.state, inputMessage({ sequence: 1 })), "QUEUE_FULL");
});

test("v2 emulator rejects acknowledgement identity mismatches and handles duplicate retirement", () => {
  const state = createInitialState(config({
    routes: [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 }],
  }));
  const output = step(state, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }).output;
  assert.ok(output);
  const pending = step(state, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }).state;
  const acknowledgement = {
    runId: RUN_ID,
    outputId: output.outputId,
    destinationCoreId: 1,
    destinationEpoch: output.destinationEpoch,
    destinationStateHash: "bb".repeat(32),
  } as const;
  const expectCode = (action: () => unknown, code: string) => {
    assert.throws(action, (error: unknown) => error instanceof Error && "code" in error && error.code === code);
  };
  expectCode(() => acknowledgeOutput(pending, { ...acknowledgement, runId: "cc".repeat(32) }), "INVALID_RUN");
  expectCode(() => acknowledgeOutput(pending, acknowledgement, 2), "UNAUTHORIZED_PEER");
  expectCode(() => acknowledgeOutput(pending, { ...acknowledgement, destinationCoreId: 2 }), "UNAUTHORIZED_PEER");
  expectCode(() => acknowledgeOutput(pending, { ...acknowledgement, destinationEpoch: 2n }), "UNAUTHORIZED_PEER");
  const retired = acknowledgeOutput(pending, acknowledgement);
  assert.equal(retired.duplicate, false);
  const duplicate = acknowledgeOutput(retired.state, acknowledgement);
  assert.equal(duplicate.duplicate, true);
});

test("v2 emulator covers non-taken flags, waiting transitions, and architectural bounds", () => {
  const cases = [
    [encodeInstruction(Opcode.ADC, 0), (state: ReturnType<typeof createInitialState>) => { state.accumulator = 1; state.registers[0] = 1; state.flags = 0; }, 2],
    [encodeInstruction(Opcode.SYS, SYS.SHL), (state: ReturnType<typeof createInitialState>) => { state.accumulator = 1; }, 2],
    [encodeInstruction(Opcode.SYS, SYS.SHR), (state: ReturnType<typeof createInitialState>) => { state.accumulator = 2; }, 1],
    [encodeInstruction(Opcode.SYS, SYS.INC), (state: ReturnType<typeof createInitialState>) => { state.accumulator = 1; }, 2],
    [encodeInstruction(Opcode.SYS, SYS.DEC), (state: ReturnType<typeof createInitialState>) => { state.accumulator = 1; }, 0],
  ] as const;
  for (const [word, prepare, accumulator] of cases) {
    const state = createInitialState(config());
    prepare(state);
    assert.equal(step(state, { rom: rom(word) }).state.accumulator, accumulator);
  }
  assert.equal(step(createInitialState(config()), { rom: rom(encodeInstruction(Opcode.JZ, 9)) }).state.pc, 1);
  assert.equal(step(createInitialState(config()), { rom: rom(encodeInstruction(Opcode.JC, 9)) }).state.pc, 1);
  const waiting = createInitialState(config());
  waiting.status = STATUS.waitingInput;
  assert.throws(() => step(waiting, { rom: rom(0) }), /RUNNING/);
  const corruptRegister = createInitialState(config());
  corruptRegister.registers = [];
  assert.throws(() => step(corruptRegister, { rom: rom(0) }), /register file/);
  const corruptRam = createInitialState(config());
  corruptRam.ram = new Uint8Array(1);
  assert.throws(() => step(corruptRam, { rom: rom(0) }), /RAM/);
  const corruptSequence = createInitialState(config());
  corruptSequence.nextOutputSequence = [0];
  assert.throws(() => step(corruptSequence, { rom: rom(0) }), /sequence table/);
});

test("v2 emulator covers advance stop reasons and epoch readiness", () => {
  const waiting = createInitialState(config({ maxStepsPerAdvance: 2 }));
  waiting.status = STATUS.waitingInput;
  const waitingResult = advance(waiting, { rom: rom(encodePortInstruction(SYS.IN, 0)) }, {
    expectedAdvanceCount: 0n, expectedStateHash: stateHash(waiting), maxInstructions: 1, maxOutputs: 1,
  });
  assert.equal(waitingResult.executed, 0);
  assert.equal(waitingResult.stopReason, STOP_REASON.inputUnavailable);
  assert.equal(waitingResult.state.status, STATUS.waitingInput);

  const backpressured = createInitialState(config({ maxOutputRecords: 1, routes: [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 }] }));
  const filledOutput = step(backpressured, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }).output;
  assert.ok(filledOutput);
  backpressured.outbox = [filledOutput];
  backpressured.status = STATUS.backpressured;
  const backpressureResult = advance(backpressured, { rom: rom(encodePortInstruction(SYS.OUTP, 0)) }, {
    expectedAdvanceCount: 0n, expectedStateHash: stateHash(backpressured), maxInstructions: 1, maxOutputs: 1,
  });
  assert.equal(backpressureResult.stopReason, STOP_REASON.outputBackpressure);

  const yielded = createInitialState(config());
  const yieldResult = advance(yielded, { rom: rom(encodeInstruction(Opcode.SYS, SYS.YIELD)) }, {
    expectedAdvanceCount: 0n, expectedStateHash: stateHash(yielded), maxInstructions: 1, maxOutputs: 1,
  });
  assert.equal(yieldResult.stopReason, STOP_REASON.yielded);
  assert.equal(yieldResult.state.status, STATUS.running);

  const halted = createInitialState(config());
  halted.status = STATUS.halted;
  assert.throws(() => advance(halted, { rom: rom(0) }, { expectedAdvanceCount: 0n, expectedStateHash: stateHash(halted), maxInstructions: 1, maxOutputs: 1 }), /halted or faulted/);
  const faulted = createInitialState(config());
  faulted.status = STATUS.faulted;
  assert.throws(() => advance(faulted, { rom: rom(0) }, { expectedAdvanceCount: 0n, expectedStateHash: stateHash(faulted), maxInstructions: 1, maxOutputs: 1 }), /halted or faulted/);
});

test("v2 emulator rejects every malformed delivery envelope and handles ordered inputs", () => {
  const route = { sourceCoreId: 1, sourcePort: 0, destinationCoreId: 0, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 };
  const base = createInitialState(config({ routes: [route] }));
  const expectCode = (message: DeliverInputMessage, code: string) => assert.throws(() => deliverInput(base, message), (error: unknown) => error instanceof Error && "code" in error && error.code === code);
  const canonical = inputMessage();
  expectCode({ ...canonical, value: 16 }, "INVALID_SEQUENCE");
  expectCode({ ...canonical, sequence: 256 }, "INVALID_SEQUENCE");
  expectCode({ ...canonical, sourcePort: -1 }, "INVALID_ROUTE");
  expectCode({ ...canonical, destinationPort: -1 }, "INVALID_ROUTE");
  expectCode({ ...canonical, sourceEpoch: 0n, destinationEpoch: 0n }, "INVALID_ROUTE");
  expectCode({ ...canonical, sourceEpoch: 1n, destinationEpoch: 2n }, "INVALID_EPOCH");

  const first = deliverInput(base, canonical).state;
  const outOfOrder = inputMessage({ sequence: 2, sourceStateHash: "bb".repeat(32) });
  const second = deliverInput(first, outOfOrder).state;
  assert.equal(second.inbox[0]?.sequence, 0);
  assert.equal(second.inbox[1]?.sequence, 2);
  const fields: Array<Partial<DeliverInputMessage>> = [
    { sourceCoreId: 2 }, { destinationCoreId: 3 }, { sourceEpoch: 1n }, { destinationEpoch: 2n }, { sourcePort: 1 },
    { destinationPort: 1 }, { sequence: 1 }, { value: 6 }, { sourceInstructionCount: 2n }, { sourceStateHash: "cc".repeat(32) },
  ];
  for (const changed of fields) {
    const existing = createInitialState(config({ routes: [route] }));
    const original = inputMessage();
    existing.inbox.push({ ...original, consumed: false });
    assert.throws(() => deliverInput(existing, { ...original, ...changed }), /conflicting|route|epoch|sequence|unauthorized|another core|identifier/i);
  }
});
