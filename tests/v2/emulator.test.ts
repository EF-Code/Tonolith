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
