import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildArtifact } from "../../packages/artifact/src/manifest.js";
import { loadArtifactDirectory } from "../../packages/sdk/src/node.js";

const compiler = { name: "tonolith-assembler", version: "2.0.0-test", gitCommit: "c".repeat(40), node: "v26.7.0" };

test("Node SDK loads and independently verifies a canonical artifact directory", async () => {
  const artifact = buildArtifact(".entry start\nstart:\nLDI 1\nHALT\n", { name: "node-loader", compiler });
  const directory = await mkdtemp(join(tmpdir(), "tonolith-v2-artifact-"));
  try {
    for (const [name, content] of Object.entries(artifact.files)) await writeFile(join(directory, name), content, "utf8");
    const loaded = await loadArtifactDirectory(directory);
    assert.equal(loaded.manifest.staticCommitment, artifact.manifest.staticCommitment);
    assert.deepEqual(loaded.assembly.words, artifact.assembly.words);
    assert.deepEqual(Array.from(loaded.assembly.ram), Array.from(artifact.assembly.ram));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
