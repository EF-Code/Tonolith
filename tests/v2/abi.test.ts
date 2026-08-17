import assert from "node:assert/strict";
import test from "node:test";
import { beginCell } from "@ton/core";
import {
  V2AbiError,
  decodeAdvanceV2,
  decodeBatchAdvancedV2,
  decodeDeliverInputV2,
  decodeDispatchOutputV2,
  decodeInputAcceptedV2,
  decodeInputCommittedV2,
  decodeOutputAcknowledgedV2,
  decodeOutputCommittedV2,
  decodeV2Event,
  decodeTopUpV2,
  decodeV2Message,
  encodeAdvanceV2,
  encodeBatchAdvancedV2,
  encodeDeliverInputV2,
  encodeDispatchOutputV2,
  encodeInputAcceptedV2,
  encodeInputCommittedV2,
  encodeOutputAcknowledgedV2,
  encodeOutputCommittedV2,
  encodeTopUpV2,
} from "../../packages/abi/src/messages.js";

const runId = "11".repeat(32);
const hash = "22".repeat(32);

test("v2 message serializers round-trip every mutating message", () => {
  const messages = [
    encodeAdvanceV2({ queryId: 1n, runId, expectedAdvanceCount: 3n, expectedStateHash: hash, maxInstructions: 4, maxOutputs: 2 }),
    encodeDispatchOutputV2({ queryId: 2n, runId, expectedStateHash: hash, outputId: "33".repeat(32) }),
    encodeDeliverInputV2({
      queryId: 3n,
      runId,
      outputId: "33".repeat(32),
      sourceCoreId: 1,
      destinationCoreId: 2,
      sourceEpoch: 4n,
      destinationEpoch: 5n,
      sourcePort: 6,
      destinationPort: 7,
      sequence: 8,
      value: 9,
      sourceInstructionCount: 10n,
      sourceStateHash: hash,
    }),
    encodeInputAcceptedV2({ queryId: 4n, runId, outputId: "33".repeat(32), destinationCoreId: 2, destinationEpoch: 5n, destinationStateHash: hash }),
    encodeTopUpV2({ queryId: 5n, runId }),
  ];
  assert.equal(decodeAdvanceV2(messages[0]!).maxInstructions, 4);
  assert.equal(decodeDispatchOutputV2(messages[1]!).outputId, "33".repeat(32));
  assert.equal(decodeDeliverInputV2(messages[2]!).value, 9);
  assert.equal(decodeInputAcceptedV2(messages[3]!).destinationEpoch, 5n);
  assert.equal(decodeTopUpV2(messages[4]!).kind, "topUp");
  assert.deepEqual(messages.map((message) => decodeV2Message(message).kind), ["advance", "dispatchOutput", "deliverInput", "inputAccepted", "topUp"]);
});

test("BatchAdvancedV2 event uses the fixed aggregate layout", () => {
  const event = {
    queryId: 7n,
    runId,
    coreId: 2,
    advanceCount: 8n,
    epoch: 9n,
    startInstructionCount: 10n,
    endInstructionCount: 11n,
    stepsExecuted: 12,
    outputsProduced: 1,
    stopReason: 5,
    previousStateHash: hash,
    nextStateHash: "33".repeat(32),
    batchCommitment: "44".repeat(32),
    finalPc: 13,
    finalStatus: 0,
  };
  assert.deepEqual(decodeBatchAdvancedV2(encodeBatchAdvancedV2(event)), { kind: "batchAdvanced", ...event });
});

test("optional output, input, and acknowledgement events have strict compact codecs", () => {
  const output = {
    queryId: 1n,
    runId,
    outputId: "33".repeat(32),
    sourceCoreId: 0,
    destinationCoreId: 1,
    epoch: 2n,
    sourcePort: 3,
    destinationPort: 4,
    sequence: 5,
    value: 6,
    outputCommitment: hash,
  };
  const input = {
    queryId: 2n,
    runId,
    outputId: output.outputId,
    sourceCoreId: 0,
    destinationCoreId: 1,
    epoch: 2n,
    destinationPort: 4,
    sequence: 5,
    inputCommitment: "44".repeat(32),
  };
  const acknowledgement = {
    queryId: 3n,
    runId,
    outputId: output.outputId,
    destinationCoreId: 1,
    destinationEpoch: 2n,
    outputCommitment: "55".repeat(32),
  };
  assert.deepEqual(decodeOutputCommittedV2(encodeOutputCommittedV2(output)), { kind: "outputCommitted", ...output });
  assert.deepEqual(decodeInputCommittedV2(encodeInputCommittedV2(input)), { kind: "inputCommitted", ...input });
  assert.deepEqual(decodeOutputAcknowledgedV2(encodeOutputAcknowledgedV2(acknowledgement)), { kind: "outputAcknowledged", ...acknowledgement });
  assert.equal(decodeV2Event(encodeInputCommittedV2(input)).kind, "inputCommitted");
});

test("v2 ABI rejects short, wrong-version, unknown-prefix, and trailing data", () => {
  assert.throws(() => decodeV2Message(beginCell().storeUint(1, 32).endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "UNKNOWN_PREFIX");
  assert.throws(() => decodeV2Message(beginCell().storeUint(0x544e4c21, 32).storeUint(1, 16).endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "INVALID_VERSION");
  assert.throws(() => decodeV2Message(beginCell().storeUint(0x544e4c21, 32).endCell()), (error: unknown) => error instanceof V2AbiError);
  const trailing = beginCell()
    .storeUint(0x544e4c25, 32)
    .storeUint(2, 16)
    .storeUint(1, 64)
    .storeUint(BigInt(`0x${runId}`), 256)
    .storeBit(1)
    .endCell();
  assert.throws(() => decodeTopUpV2(trailing), (error: unknown) => error instanceof V2AbiError && error.code === "TRAILING_DATA");
  const ref = beginCell()
    .storeUint(0x544e4c25, 32)
    .storeUint(2, 16)
    .storeUint(1, 64)
    .storeUint(BigInt(`0x${runId}`), 256)
    .storeRef(beginCell().endCell())
    .endCell();
  assert.throws(() => decodeTopUpV2(ref), (error: unknown) => error instanceof V2AbiError && error.code === "TRAILING_DATA");
});
