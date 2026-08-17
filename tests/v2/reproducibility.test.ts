import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildArtifact, verifyArtifact } from "../../packages/artifact/src/manifest.js";
import { loadArtifactDirectorySync } from "../../packages/sdk/src/node.js";

const compiler = {
  name: "tonolith-assembler",
  version: "2.0.0-test",
  gitCommit: "b".repeat(40),
  node: "v26.7.0",
};

test("v2 artifacts reproduce byte-for-byte in two clean directories", async () => {
  const artifact = buildArtifact(".entry start\nstart:\nLDI 1\nOUT\nHALT\n", {
    name: "clean-repro-fixture",
    fileName: "repro.tasm",
    compiler,
  });
  assert.equal(verifyArtifact(artifact).valid, true);
  const root = await mkdtemp(join(tmpdir(), "tonolith-v2-repro-"));
  try {
    const directories = [join(root, "clean-a"), join(root, "clean-b")];
    for (const directory of directories) {
      await mkdir(directory, { recursive: true });
      await Promise.all(Object.entries(artifact.files).map(async ([name, contents]) => {
        await writeFile(join(directory, name), contents, "utf8");
      }));
    }
    const first = loadArtifactDirectorySync(directories[0]!);
    const second = loadArtifactDirectorySync(directories[1]!);
    assert.deepEqual(first.manifest, second.manifest);
    assert.deepEqual(Object.keys(first.files).sort(), Object.keys(second.files).sort());
    for (const name of Object.keys(first.files).sort()) {
      const firstBytes = await readFile(join(directories[0]!, name));
      const secondBytes = await readFile(join(directories[1]!, name));
      assert.equal(sha256(firstBytes), sha256(secondBytes), `generated file differs: ${name}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
