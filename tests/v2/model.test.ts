import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, assertStateBounds, cloneState, zeroHash, type CoreConfig } from "../../packages/emulator/src/model.js";

const config: CoreConfig = {
  runId: "11".repeat(32),
  coreId: 0,
  programId: "22".repeat(32),
  romRoot: "33".repeat(32),
  initialRamRoot: "44".repeat(32),
  routeRoot: "55".repeat(32),
  staticCommitment: "66".repeat(32),
  routes: [{
    sourceCoreId: 0,
    sourcePort: 0,
    destinationCoreId: 1,
    destinationPort: 0,
    delay: 1,
    maxRecordsPerEpoch: 4,
  }],
  requiredInputs: [{ port: 0, count: 1 }],
  maxStepsPerAdvance: 1,
};

test("v2 initial state is bounded and fully initialized", () => {
  const state = createInitialState(config);
  assertStateBounds(state);
  assert.equal(state.status, 0);
  assert.equal(state.inbox.length, 0);
  assert.equal(state.outbox.length, 0);
  assert.equal(state.outputCommitment, zeroHash());
  assert.equal(state.nextOutputSequence.length, 16);
});

test("v2 state cloning does not alias mutable protocol data", () => {
  const original = createInitialState(config);
  const clone = cloneState(original);
  clone.registers[0] = 15;
  clone.ram[0] = 14;
  clone.nextOutputSequence[0] = 1;
  assert.equal(original.registers[0], 0);
  assert.equal(original.ram[0], 0);
  assert.equal(original.nextOutputSequence[0], 0);
});

test("v2 configuration rejects duplicate quotas and malformed identities", () => {
  assert.throws(() => createInitialState({ ...config, runId: "bad" }));
  assert.throws(() => createInitialState({
    ...config,
    requiredInputs: [{ port: 0, count: 1 }, { port: 0, count: 1 }],
  }));
  assert.throws(() => createInitialState({
    ...config,
    routes: [{ ...config.routes[0]!, delay: 0 }],
  }));
});
