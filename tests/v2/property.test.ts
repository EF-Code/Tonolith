import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeInstruction, encodePortInstruction, encodeTrap } from "../../packages/isa/src/codec.js";
import { Opcode } from "../../packages/isa/src/types.js";
import { SYS } from "../../packages/isa/src/constants.js";
import { advance, step } from "../../packages/emulator/src/executor.js";
import { stateHash } from "../../packages/emulator/src/commitments.js";
import { assertStateBounds, cloneState, createInitialState, type CoreConfig, type V2State } from "../../packages/emulator/src/model.js";

interface FuzzSeeds {
  readonly property: { readonly seed: string; readonly iterations: number };
  readonly statefulBatch: { readonly seed: string; readonly iterations: number; readonly batchSize: number };
}

test("v2 recorded-seed property traces preserve step invariants", async () => {
  const seeds = JSON.parse(await readFile(new URL("../../spec/v2/fuzz-seeds.json", import.meta.url), "utf8")) as FuzzSeeds;
  let random = seedFrom(seeds.property.seed);
  for (let iteration = 0; iteration < seeds.property.iterations; iteration += 1) {
    const state = randomState(random);
    random = state.random;
    const word = randomWord(() => {
      const next = nextRandom(random);
      random = next.random;
      return next.value;
    });
    const before = cloneState(state.state);
    const result = step(state.state, { rom: [word, ...new Array(1023).fill(0)] });
    assert.deepEqual(state.state, before, `input mutated at iteration ${iteration}`);
    assertStateBounds(result.state);
    const replay = step(before, { rom: [word, ...new Array(1023).fill(0)] });
    assert.equal(stateHash(result.state), stateHash(replay.state), `non-deterministic result at iteration ${iteration}`);
    if (result.executed) {
      assert.equal(result.state.instructionCount, before.instructionCount + 1n);
      assert.equal(result.state.pc >= 0 && result.state.pc < 1024, true);
    } else {
      assert.equal(result.state.instructionCount, before.instructionCount);
      assert.equal(result.state.pc, before.pc);
    }
  }
});

test("v2 recorded-seed batches agree with repeated single-step execution", async () => {
  const seeds = JSON.parse(await readFile(new URL("../../spec/v2/fuzz-seeds.json", import.meta.url), "utf8")) as FuzzSeeds;
  let random = seedFrom(seeds.statefulBatch.seed);
  for (let iteration = 0; iteration < seeds.statefulBatch.iterations; iteration += 1) {
    const words: number[] = [];
    for (let index = 0; index < seeds.statefulBatch.batchSize; index += 1) {
      const next = nextRandom(random);
      random = next.random;
      words.push(randomNonStoppingWord(() => {
        const value = nextRandom(random);
        random = value.random;
        return value.value;
      }));
    }
    const generatedState = randomState(random);
    const initial = generatedState.state;
    random = generatedState.random;
    const environment = { rom: [...words, ...new Array(1024 - words.length).fill(0)] };
    const batched = advance(initial, environment, {
      expectedAdvanceCount: initial.advanceCount,
      expectedStateHash: stateHash(initial),
      maxInstructions: seeds.statefulBatch.batchSize,
      maxOutputs: 16,
    });
    let repeated = initial;
    for (let index = 0; index < seeds.statefulBatch.batchSize; index += 1) {
      repeated = step(repeated, environment).state;
    }
    repeated.advanceCount += 1n;
    repeated.acceptedMessageCount += 1n;
    assert.equal(batched.executed, seeds.statefulBatch.batchSize, `batch stopped at iteration ${iteration}`);
    assert.deepEqual(stripProtocolCounters(batched.state), stripProtocolCounters(repeated));
    assert.equal(batched.state.advanceCount, repeated.advanceCount);
    assert.equal(batched.state.acceptedMessageCount, repeated.acceptedMessageCount);
  }
});

function randomState(random: number): { readonly random: number; readonly state: V2State } {
  const state = createInitialState(config());
  const values: number[] = [];
  for (let index = 0; index < 2 + 16 + 256; index += 1) {
    const next = nextRandom(random);
    random = next.random;
    values.push(next.value & 0x0f);
  }
  state.accumulator = values[0]!;
  state.flags = values[1]! & 3;
  state.registers = values.slice(2, 18);
  state.ram = Uint8Array.from(values.slice(18));
  state.pc = 0;
  return { random, state };
}

function randomWord(random: () => number): number {
  const opcode = random() % 16;
  if (opcode === Opcode.SYS) {
    const subop = random() % 13;
    if (subop === SYS.IN || subop === SYS.OUTP) return encodePortInstruction(subop, random() % 16);
    if (subop === SYS.TRAP) return encodeTrap(random() & 0xff);
    return encodeInstruction(Opcode.SYS, subop);
  }
  if (opcode === Opcode.LDI || opcode >= Opcode.LDR && opcode <= Opcode.XOR) return encodeInstruction(opcode, random() % 16);
  if (opcode === Opcode.LDM || opcode === Opcode.STM) return encodeInstruction(opcode, random() % 256);
  if (opcode >= Opcode.JMP && opcode <= Opcode.JC) return encodeInstruction(opcode, random() % 1024);
  return encodeInstruction(opcode);
}

function randomNonStoppingWord(random: () => number): number {
  const opcodes = [Opcode.NOP, Opcode.LDI, Opcode.LDR, Opcode.STR, Opcode.ADD, Opcode.ADC, Opcode.SUB, Opcode.AND, Opcode.OR, Opcode.XOR, Opcode.LDM, Opcode.STM, Opcode.SYS];
  const opcode = opcodes[random() % opcodes.length]!;
  if (opcode === Opcode.SYS) {
    const controls = [SYS.CLC, SYS.STC, SYS.NOT, SYS.SHL, SYS.SHR, SYS.INC, SYS.DEC];
    return encodeInstruction(Opcode.SYS, controls[random() % controls.length]!);
  }
  if (opcode === Opcode.LDI || opcode >= Opcode.LDR && opcode <= Opcode.XOR) return encodeInstruction(opcode, random() % 16);
  if (opcode === Opcode.LDM || opcode === Opcode.STM) return encodeInstruction(opcode, random() % 256);
  return encodeInstruction(opcode);
}

function config(): CoreConfig {
  return {
    runId: "11".repeat(32),
    coreId: 0,
    programId: "22".repeat(32),
    romRoot: "33".repeat(32),
    initialRamRoot: "44".repeat(32),
    routeRoot: "55".repeat(32),
    staticCommitment: "66".repeat(32),
    routes: Array.from({ length: 16 }, (_, sourcePort) => ({ sourceCoreId: 0, sourcePort, destinationCoreId: 1, destinationPort: sourcePort, delay: 1, maxRecordsPerEpoch: 16 })),
    requiredInputs: [],
    maxStepsPerAdvance: 4,
  };
}

function stripProtocolCounters(state: V2State): unknown {
  const { advanceCount: _advanceCount, acceptedMessageCount: _acceptedMessageCount, ...architectural } = state;
  return architectural;
}

function seedFrom(value: string): number {
  return Number.parseInt(value.replace(/^0x/, ""), 16) >>> 0;
}

function nextRandom(random: number): { readonly random: number; readonly value: number } {
  const next = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
  return { random: next, value: next };
}
