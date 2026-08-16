import assert from "node:assert/strict";
import test from "node:test";
import { decodeTrace, encodeTrace, type TonolithTraceV2 } from "../../packages/trace/src/index.js";

const state = { stateHash: "01".repeat(32), pc: 0, accumulator: 0, flags: 0, epoch: "0", instructionCount: "0", advanceCount: "0", status: 0, outputCommitment: "00".repeat(32), inputCommitment: "00".repeat(32), inboxCount: 0, outboxCount: 0 };
const trace: TonolithTraceV2 = {
  schema: "tonolith-trace-v2",
  evidence: "local-emulator",
  network: "local",
  runId: "02".repeat(32),
  coreIds: [0],
  programId: "03".repeat(32),
  romRoot: "04".repeat(32),
  routeRoot: "05".repeat(32),
  staticCommitment: "06".repeat(32),
  frames: [{ index: 0, coreId: 0, before: state, after: { ...state, stateHash: "07".repeat(32), instructionCount: "1" }, phase: "none" }],
  unresolved: [],
};

test("v2 trace schema is strict, deterministic, and round-trippable", () => {
  const encoded = encodeTrace(trace);
  assert.deepEqual(decodeTrace(encoded), trace);
  assert.throws(() => decodeTrace(encoded.replace("tonolith-trace-v2", "trace-v1")), /unsupported trace schema/);
  assert.throws(() => decodeTrace(JSON.stringify({ ...trace, frames: [{ ...trace.frames[0], index: 2 }, { ...trace.frames[0], index: 1 }] })), /strictly increasing/);
});
