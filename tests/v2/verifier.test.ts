import assert from "node:assert/strict";
import test from "node:test";
import { beginCell } from "@ton/core";
import { encodeAdvanceV2 } from "../../packages/abi/src/messages.js";
import { encodeDeliverInputV2, encodeInputAcceptedV2 } from "../../packages/abi/src/messages.js";
import { buildArtifact } from "../../packages/artifact/src/manifest.js";
import { coreStateCell, stateHash } from "../../packages/emulator/src/commitments.js";
import { acknowledgeOutput, advance, deliverInput } from "../../packages/emulator/src/executor.js";
import { buildV2StateInitFromArtifact } from "../../packages/sdk/src/stateinit.js";
import { verifyAccount, verifyHistoryContinuity, verifyRunFromSources, type RawChainSnapshot, type RawChainSource } from "../../packages/verifier/src/index.js";
import { outputId } from "../../packages/emulator/src/commitments.js";

const compiler = {
  name: "tonolith-assembler",
  version: "2.0.0-test",
  gitCommit: "c".repeat(40),
  node: "v26.7.0",
};

test("independent verifier checks StateInit, history, provider agreement, and emulator replay", async () => {
  const artifact = buildArtifact(".entry start\nstart:\nLDI 1\nHALT\n", { name: "verifier-fixture", compiler });
  const deployment = buildV2StateInitFromArtifact(beginCell().storeUint(1, 1).endCell(), artifact);
  const advanced = advance(
    deployment.initialState,
    { rom: artifact.assembly.words },
    {
      expectedAdvanceCount: 0n,
      expectedStateHash: deployment.initialStateHash,
      maxInstructions: 1,
      maxOutputs: 1,
    },
  );
  const deploymentHash = "d".repeat(64);
  const advanceHash = "e".repeat(64);
  const snapshot: RawChainSnapshot = {
    source: "fixture-a",
    network: "testnet",
    account: {
      address: deployment.address.toRawString(),
      codeBoc: deployment.stateInit.code!.toBoc({ idx: false }).toString("base64"),
      dataBoc: deployment.data.toBoc({ idx: false }).toString("base64"),
      stateInitBoc: deployment.stateInitCell.toBoc({ idx: false }).toString("base64"),
    },
    transactions: [
      { hash: deploymentHash, lt: "1", success: true, outbound: [] },
      {
        hash: advanceHash,
        lt: "2",
        prevTransactionHash: deploymentHash,
        prevTransactionLt: "1",
        success: true,
        inbound: {
          direction: "in",
          destination: deployment.address.toRawString(),
          bodyBoc: encodeAdvanceV2({
            queryId: 1n,
            runId: artifact.manifest.runId,
            expectedAdvanceCount: 0n,
            expectedStateHash: deployment.initialStateHash,
            maxInstructions: 1,
            maxOutputs: 1,
          }).toBoc({ idx: false }).toString("base64"),
        },
        outbound: [],
        stateDataBoc: coreStateCell(advanced.state).toBoc({ idx: false }).toString("base64"),
        feesNano: "1000",
      },
    ],
  };
  const source = (id: string, value: RawChainSnapshot = snapshot): RawChainSource => ({
    id,
    fetchSnapshot: async () => ({ ...value, source: id }),
  });
  const report = await verifyRunFromSources(
    deployment.address.toRawString(),
    {
      address: deployment.address.toRawString(),
      network: "testnet",
      codeHash: deployment.codeHash,
      dataHash: deployment.dataHash,
      stateInitHash: deployment.stateInitHash,
      programId: artifact.manifest.programId,
      runId: artifact.manifest.runId,
      romRoot: artifact.manifest.romRoot,
      routeRoot: artifact.manifest.routeRoot,
      staticCommitment: artifact.manifest.staticCommitment,
    },
    [source("fixture-a"), source("fixture-b")],
    { initialState: deployment.initialState, rom: artifact.assembly.words },
  );
  assert.equal(report.overall, "verified");
  assert.equal(report.acceptedAdvances, 1);
  assert.equal(report.executedInstructions, 1n);
  assert.equal(report.finalStateHash, advanced.nextStateHash);
  assert.equal(report.totalFeesNano, "1000");

  const disagreement = await verifyRunFromSources(
    deployment.address.toRawString(),
    {
      address: deployment.address.toRawString(),
      network: "testnet",
      codeHash: deployment.codeHash,
      dataHash: deployment.dataHash,
      stateInitHash: deployment.stateInitHash,
      programId: artifact.manifest.programId,
      runId: artifact.manifest.runId,
      romRoot: artifact.manifest.romRoot,
      routeRoot: artifact.manifest.routeRoot,
      staticCommitment: artifact.manifest.staticCommitment,
    },
    [source("fixture-a"), source("fixture-b", { ...snapshot, transactions: [{ ...snapshot.transactions[0]!, hash: "f".repeat(64) }, ...snapshot.transactions.slice(1)] })],
  );
  assert.equal(disagreement.overall, "failed");
  assert.match(disagreement.errors.join("\n"), /provider disagreement/);
});

test("verifier rejects StateInit/data drift and incomplete predecessor links", async () => {
  const artifact = buildArtifact("NOP\n", { name: "verifier-integrity-fixture", compiler });
  const deployment = buildV2StateInitFromArtifact(beginCell().storeUint(1, 1).endCell(), artifact);
  const expectations = {
    address: deployment.address.toRawString(),
    network: "testnet",
    codeHash: deployment.codeHash,
    dataHash: deployment.dataHash,
    stateInitHash: deployment.stateInitHash,
    programId: artifact.manifest.programId,
    runId: artifact.manifest.runId,
    romRoot: artifact.manifest.romRoot,
    routeRoot: artifact.manifest.routeRoot,
    staticCommitment: artifact.manifest.staticCommitment,
  } as const;
  const account = {
    address: deployment.address.toRawString(),
    codeBoc: deployment.stateInit.code!.toBoc({ idx: false }).toString("base64"),
    dataBoc: beginCell().storeUint(0, 1).endCell().toBoc({ idx: false }).toString("base64"),
    stateInitBoc: deployment.stateInitCell.toBoc({ idx: false }).toString("base64"),
  };
  assert.match(verifyAccount(account, expectations).join("\n"), /data hash mismatch/);
  assert.match(
    verifyHistoryContinuity([
      { hash: "a".repeat(64), lt: "1", success: true, outbound: [] },
      { hash: "b".repeat(64), lt: "2", success: true, outbound: [] },
    ]).join("\n"),
    /predecessor hash is missing/,
  );
});

test("verifier replays authenticated delivery and acknowledgement state transitions", async () => {
  const peerAddress = `0:${"ab".repeat(32)}`;
  const artifact = buildArtifact("LDI 3\nOUTP 0\n", {
    name: "verifier-protocol-fixture",
    routes: [
      { sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 },
      { sourceCoreId: 1, sourcePort: 0, destinationCoreId: 0, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 4 },
    ],
    peers: [{ coreId: 1, address: peerAddress }],
    compiler,
  });
  const deployment = buildV2StateInitFromArtifact(beginCell().storeUint(1, 1).endCell(), artifact);
  const firstAdvance = advance(deployment.initialState, { rom: artifact.assembly.words }, {
    queryId: 1n,
    expectedAdvanceCount: 0n,
    expectedStateHash: deployment.initialStateHash,
    maxInstructions: 1,
    maxOutputs: 1,
  });
  const secondAdvance = advance(firstAdvance.state, { rom: artifact.assembly.words }, {
    queryId: 2n,
    expectedAdvanceCount: 1n,
    expectedStateHash: firstAdvance.nextStateHash,
    maxInstructions: 1,
    maxOutputs: 1,
  });
  const pendingOutput = secondAdvance.outputs[0]!;
  const acknowledgement = {
    queryId: 3n,
    runId: artifact.manifest.runId,
    outputId: pendingOutput.outputId,
    destinationCoreId: 1,
    destinationEpoch: pendingOutput.destinationEpoch,
    destinationStateHash: secondAdvance.nextStateHash,
  } as const;
  const acknowledged = acknowledgeOutput(secondAdvance.state, acknowledgement, 1);
  const inputBase = {
    sourceCoreId: 1,
    destinationCoreId: 0,
    sourceEpoch: 0n,
    destinationEpoch: 1n,
    sourcePort: 0,
    destinationPort: 0,
    sequence: 0,
    value: 7,
    sourceInstructionCount: 1n,
    sourceStateHash: "00".repeat(32),
  } as const;
  const inputMessage = {
    queryId: 4n,
    runId: artifact.manifest.runId,
    outputId: outputId(artifact.manifest.runId, inputBase),
    ...inputBase,
  } as const;
  const delivered = deliverInput(acknowledged.state, inputMessage, 1);
  const encodeMessage = (message: Parameters<typeof encodeInputAcceptedV2>[0] | Parameters<typeof encodeDeliverInputV2>[0]) => {
    if ("destinationStateHash" in message) return encodeInputAcceptedV2(message).toBoc({ idx: false }).toString("base64");
    return encodeDeliverInputV2(message).toBoc({ idx: false }).toString("base64");
  };
  const snapshot: RawChainSnapshot = {
    source: "protocol-fixture-a",
    network: "testnet",
    account: {
      address: deployment.address.toRawString(),
      codeBoc: deployment.stateInit.code!.toBoc({ idx: false }).toString("base64"),
      dataBoc: deployment.data.toBoc({ idx: false }).toString("base64"),
      stateInitBoc: deployment.stateInitCell.toBoc({ idx: false }).toString("base64"),
    },
    transactions: [
      { hash: "1".repeat(64), lt: "1", success: true, outbound: [] },
      {
        hash: "2".repeat(64), lt: "2", prevTransactionHash: "1".repeat(64), prevTransactionLt: "1", success: true,
        inbound: { direction: "in", bodyBoc: encodeAdvanceV2({ queryId: 1n, runId: artifact.manifest.runId, expectedAdvanceCount: 0n, expectedStateHash: deployment.initialStateHash, maxInstructions: 1, maxOutputs: 1 }).toBoc({ idx: false }).toString("base64") },
        outbound: [], stateDataBoc: coreStateCell(firstAdvance.state).toBoc({ idx: false }).toString("base64"),
      },
      {
        hash: "3".repeat(64), lt: "3", prevTransactionHash: "2".repeat(64), prevTransactionLt: "2", success: true,
        inbound: { direction: "in", bodyBoc: encodeAdvanceV2({ queryId: 2n, runId: artifact.manifest.runId, expectedAdvanceCount: 1n, expectedStateHash: firstAdvance.nextStateHash, maxInstructions: 1, maxOutputs: 1 }).toBoc({ idx: false }).toString("base64") },
        outbound: [], stateDataBoc: coreStateCell(secondAdvance.state).toBoc({ idx: false }).toString("base64"),
      },
      {
        hash: "4".repeat(64), lt: "4", prevTransactionHash: "3".repeat(64), prevTransactionLt: "3", success: true,
        inbound: { direction: "in", source: peerAddress, bodyBoc: encodeInputAcceptedV2(acknowledgement).toBoc({ idx: false }).toString("base64") },
        outbound: [], stateDataBoc: coreStateCell(acknowledged.state).toBoc({ idx: false }).toString("base64"),
      },
      {
        hash: "5".repeat(64), lt: "5", prevTransactionHash: "4".repeat(64), prevTransactionLt: "4", success: true,
        inbound: { direction: "in", source: peerAddress, bodyBoc: encodeDeliverInputV2(inputMessage).toBoc({ idx: false }).toString("base64") },
        outbound: [{ direction: "out", bodyBoc: encodeMessage({ ...acknowledgement, outputId: inputMessage.outputId, destinationEpoch: inputMessage.destinationEpoch, destinationStateHash: stateHash(delivered.state) }) }],
        stateDataBoc: coreStateCell(delivered.state).toBoc({ idx: false }).toString("base64"),
      },
    ],
  };
  const source = (id: string): RawChainSource => ({ id, fetchSnapshot: async () => ({ ...snapshot, source: id }) });
  const report = await verifyRunFromSources(
    deployment.address.toRawString(),
    { address: deployment.address.toRawString(), network: "testnet", codeHash: deployment.codeHash, dataHash: deployment.dataHash, stateInitHash: deployment.stateInitHash, programId: artifact.manifest.programId, runId: artifact.manifest.runId, romRoot: artifact.manifest.romRoot, routeRoot: artifact.manifest.routeRoot, staticCommitment: artifact.manifest.staticCommitment },
    [source("protocol-fixture-a"), source("protocol-fixture-b")],
    { initialState: deployment.initialState, rom: artifact.assembly.words, peerIdsByAddress: { [peerAddress]: 1 } },
  );
  assert.equal(report.overall, "verified");
  assert.equal(report.deliveredInputs, 1);
  assert.equal(report.duplicateDeliveries, 0);
  assert.deepEqual(report.replayedMessageKinds, ["advance", "deliverInput", "inputAccepted"]);
  assert.equal(report.stateSnapshotsChecked, 4);
  assert.equal(report.providerAgreement, true);
});
