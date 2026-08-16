import assert from "node:assert/strict";
import test from "node:test";
import { beginCell } from "@ton/core";
import { encodeAdvanceV2 } from "../../packages/abi/src/messages.js";
import { buildArtifact } from "../../packages/artifact/src/manifest.js";
import { coreStateCell } from "../../packages/emulator/src/commitments.js";
import { advance } from "../../packages/emulator/src/executor.js";
import { buildV2StateInitFromArtifact } from "../../packages/sdk/src/stateinit.js";
import { verifyRunFromSources, type RawChainSnapshot, type RawChainSource } from "../../packages/verifier/src/index.js";

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
