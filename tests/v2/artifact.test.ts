import assert from "node:assert/strict";
import test from "node:test";
import { Cell } from "@ton/core";
import { programId as emulatorProgramId, staticCommitmentCell as emulatorStaticCommitmentCell } from "../../packages/emulator/src/commitments.js";
import {
  assertArtifact,
  buildArtifact,
  canonicalJson,
  verifyArtifact,
} from "../../packages/artifact/src/manifest.js";

const compiler = {
  name: "tonolith-assembler",
  version: "2.0.0-test",
  gitCommit: "a".repeat(40),
  node: "v26.7.0",
};

test("v2 artifact builder emits deterministic files and independently matching commitments", () => {
  const source = `.entry start\n.ram 0x04 0xA\nstart:\nLDI 1\nOUT\nHALT\n`;
  const first = buildArtifact(source, { name: "fixture", description: "deterministic fixture", compiler });
  const second = buildArtifact(source, { name: "fixture", description: "deterministic fixture", compiler });
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.files, second.files);
  assert.equal(verifyArtifact(first).valid, true);
  assert.doesNotThrow(() => assertArtifact(first));
  assert.equal(first.files["artifact.json"], canonicalJson(first.manifest));
  assert.equal(Cell.fromBoc(Buffer.from(first.files["program.rom.boc"]!, "base64"))[0]?.hash().toString("hex"), first.manifest.romRoot);
  assert.equal(Cell.fromBoc(Buffer.from(first.files["initial-ram.boc"]!, "base64"))[0]?.hash().toString("hex"), first.manifest.initialRamRoot);

  const emulatorProgram = emulatorProgramId({
    artifactVersion: 2,
    isaVersion: 2,
    wordBits: 16,
    romWords: 1024,
    ramNibbles: 256,
    entryPc: first.manifest.entryPc,
    romRoot: first.manifest.romRoot,
    initialRamRoot: first.manifest.initialRamRoot,
  });
  assert.equal(emulatorProgram, first.manifest.programId);
  assert.equal(emulatorStaticCommitmentCell({
    schemaVersion: 2,
    isaVersion: 2,
    abiVersion: 2,
    protocolVersion: 2,
    runId: first.manifest.runId,
    coreId: first.manifest.coreId,
    programId: first.manifest.programId,
    romRoot: first.manifest.romRoot,
    routeRoot: first.manifest.routeRoot,
    peerRoot: first.manifest.peerRoot,
    limitsHash: first.manifest.limitsHash,
  }).hash().toString("hex"), first.manifest.staticCommitment);
});

test("artifact verification detects commitment and version tampering", () => {
  const bundle = buildArtifact(".entry 0\nNOP\n", { name: "tamper-fixture", compiler });
  const tamperedManifest = { ...bundle.manifest, programId: "f".repeat(64) } as typeof bundle.manifest;
  const report = verifyArtifact({ ...bundle, manifest: tamperedManifest });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /programId|staticCommitment/);

  const badVersion = { ...bundle.manifest, isaVersion: 1 } as unknown as typeof bundle.manifest;
  assert.equal(verifyArtifact({ ...bundle, manifest: badVersion }).valid, false);
});

test("artifact build rejects invalid compiler metadata and noncanonical limits", () => {
  assert.throws(() => buildArtifact("NOP\n", { name: "bad", compiler: { ...compiler, gitCommit: "not-a-commit" } }), /compiler metadata/);
  assert.throws(() => buildArtifact("NOP\n", { name: "bad", compiler, limits: { maxOutputRecords: 17 } }), /maxOutputRecords/);
});

test("artifact verification accepts a run-manifest supplied multi-core run ID", () => {
  const artifact = buildArtifact("NOP\n", { name: "multi-core-member", compiler, runId: "ab".repeat(32) });
  assert.equal(verifyArtifact(artifact).valid, true);
});
