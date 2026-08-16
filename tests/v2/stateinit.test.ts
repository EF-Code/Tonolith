import assert from "node:assert/strict";
import test from "node:test";
import { beginCell, Cell, contractAddress } from "@ton/core";
import { buildArtifact } from "../../packages/artifact/src/manifest.js";
import { buildV2StateInitFromArtifact } from "../../packages/sdk/src/stateinit.js";

const compiler = {
  name: "tonolith-assembler",
  version: "2.0.0-test",
  gitCommit: "b".repeat(40),
  node: "v26.7.0",
};

test("v2 StateInit and address derivation are deterministic and content-bound", () => {
  const artifact = buildArtifact(".entry start\nstart:\nLDI 1\nHALT\n", {
    name: "stateinit-fixture",
    compiler,
  });
  const code = beginCell().storeUint(0xdead, 16).endCell();
  const first = buildV2StateInitFromArtifact(code, artifact);
  const second = buildV2StateInitFromArtifact(code, artifact);

  assert.equal(first.stateInitHash, first.stateInitCell.hash().toString("hex"));
  assert.equal(first.dataHash, first.data.hash().toString("hex"));
  assert.equal(first.codeHash, code.hash().toString("hex"));
  assert.equal(first.address.toRawString(), contractAddress(0, first.stateInit).toRawString());
  assert.equal(first.address.toRawString(), second.address.toRawString());
  assert.equal(first.stateInitHash, second.stateInitHash);
  assert.equal(first.initialStateHash, second.initialStateHash);
  assert.equal(first.staticCommitment, artifact.manifest.staticCommitment);
  assert.equal(first.initialState.config.staticCommitment, artifact.manifest.staticCommitment);
  assert.equal(Cell.fromBoc(first.stateInitCell.toBoc({ idx: false }))[0]?.hash().toString("hex"), first.stateInitHash);
});

test("peer addresses are bound to the static commitment and StateInit data", () => {
  const artifact = buildArtifact("NOP\n", {
    name: "peer-fixture",
    compiler,
    peers: [{ coreId: 1, address: `0:${"11".repeat(32)}` }],
  });
  const code = beginCell().storeUint(1, 1).endCell();
  const result = buildV2StateInitFromArtifact(code, artifact);
  assert.notEqual(result.staticCommitment, "0".repeat(64));
  assert.equal(result.data.beginParse().remainingRefs, 4);
  assert.throws(
    () => buildV2StateInitFromArtifact(code, { ...artifact, manifest: { ...artifact.manifest, peerRoot: "0".repeat(64) } }),
    /peer root/,
  );
});
