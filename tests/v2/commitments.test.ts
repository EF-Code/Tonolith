import assert from "node:assert/strict";
import test from "node:test";
import { DOMAIN } from "../../packages/isa/src/constants.js";
import {
  coreStateCell,
  inputRecordCell,
  nextEpochCommitment,
  outputId,
  outputRecordCell,
  programId,
  routeRoot,
  stateHash,
  staticCommitmentCell,
} from "../../packages/emulator/src/commitments.js";
import { createInitialState, type CoreConfig, type OutputRecord } from "../../packages/emulator/src/model.js";

const config: CoreConfig = {
  runId: "11".repeat(32),
  coreId: 0,
  programId: "22".repeat(32),
  romRoot: "33".repeat(32),
  initialRamRoot: "44".repeat(32),
  routeRoot: "55".repeat(32),
  staticCommitment: "66".repeat(32),
  routes: [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 }],
  requiredInputs: [],
  maxStepsPerAdvance: 1,
};

test("program and static commitments use fixed-width domain-separated cells", () => {
  const id = programId({
    artifactVersion: 2,
    isaVersion: 2,
    wordBits: 16,
    romWords: 1024,
    ramNibbles: 256,
    entryPc: 0,
    romRoot: config.romRoot,
    initialRamRoot: config.initialRamRoot,
  });
  assert.match(id, /^[0-9a-f]{64}$/);
  const staticCell = staticCommitmentCell({
    schemaVersion: 2,
    isaVersion: 2,
    abiVersion: 2,
    protocolVersion: 2,
    runId: config.runId,
    coreId: 0,
    programId: id,
    romRoot: config.romRoot,
    routeRoot: config.routeRoot,
    limitsHash: "77".repeat(32),
  });
  assert.equal(staticCell.beginParse().loadUint(32), DOMAIN.static);
  assert.notEqual(staticCell.hash().toString("hex"), staticCommitmentCell({
    schemaVersion: 2,
    isaVersion: 2,
    abiVersion: 2,
    protocolVersion: 2,
    runId: config.runId,
    coreId: 1,
    programId: id,
    romRoot: config.romRoot,
    routeRoot: config.routeRoot,
    limitsHash: "77".repeat(32),
  }).hash().toString("hex"));
});

test("state, record, route, and epoch commitments are deterministic", () => {
  const state = createInitialState(config);
  const first = stateHash(state);
  assert.equal(first, stateHash(state));
  state.accumulator = 1;
  assert.notEqual(first, stateHash(state));

  const outputBase: Omit<OutputRecord, "outputId"> = {
    sourceCoreId: 0,
    destinationCoreId: 1,
    sourceEpoch: 0n,
    destinationEpoch: 1n,
    sourcePort: 0,
    destinationPort: 0,
    sequence: 0,
    value: 9,
    sourceInstructionCount: 4n,
    sourceStateHash: first,
  };
  const record = { ...outputBase, outputId: outputId(outputBase) };
  assert.equal(outputRecordCell(record).beginParse().loadUint(32), DOMAIN.output);
  assert.equal(inputRecordCell({ ...record, consumed: false }).beginParse().loadUint(32), DOMAIN.input);
  assert.match(routeRoot(config.routes), /^[0-9a-f]{64}$/);
  assert.match(nextEpochCommitment("00".repeat(32), 0n, first, "11".repeat(32), "22".repeat(32)), /^[0-9a-f]{64}$/);
});

test("the core state cell remains a bounded three-reference root", () => {
  const state = createInitialState(config);
  const slice = coreStateCell(state).beginParse();
  slice.loadUint(32);
  slice.loadUintBig(256);
  for (const width of [3, 8, 10, 4, 2, 64, 64, 64, 64, 64, 128]) {
    slice.loadUint(width);
  }
  assert.equal(slice.remainingRefs, 3);
});
