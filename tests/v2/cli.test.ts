import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli, type CliIo } from "../../tools/tonolith-v2.js";

test("v2 CLI assembles, verifies, and benchmarks a portable artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "tonolith-v2-cli-"));
  try {
    const source = join(root, "program.tasm");
    const artifact = join(root, "artifact");
    await writeFile(source, ".entry start\nstart:\nNOP\nHALT\n", "utf8");
    const assembled = await capture((io) => runCli(["assemble", source, "--out", artifact], io));
    assert.equal(assembled.code, 0);
    const assembledJson = JSON.parse(assembled.stdout) as { readonly artifactDir: string };
    assert.equal(assembledJson.artifactDir, artifact);

    const verified = await capture((io) => runCli(["verify-artifact", artifact], io));
    assert.equal(verified.code, 0);
    assert.equal((JSON.parse(verified.stdout) as { readonly valid: boolean }).valid, true);

    const benchmark = await capture((io) => runCli(["benchmark", "local", artifact], io));
    assert.equal(benchmark.code, 0);
    const benchmarkJson = JSON.parse(benchmark.stdout) as {
      readonly requestedMaxInstructions: number;
      readonly requestedMaxOutputs: number;
      readonly executed: number;
    };
    assert.equal(benchmarkJson.requestedMaxInstructions, 1);
    assert.equal(benchmarkJson.requestedMaxOutputs, 16);
    assert.equal(benchmarkJson.executed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 CLI validates trace input and keeps network replay fail-closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "tonolith-v2-trace-"));
  try {
    const hash = "0".repeat(64);
    const state = {
      stateHash: hash,
      pc: 0,
      accumulator: 0,
      flags: 0,
      epoch: "0",
      instructionCount: "0",
      advanceCount: "0",
      status: 0,
      outputCommitment: hash,
      inputCommitment: hash,
      inboxCount: 0,
      outboxCount: 0,
    };
    const tracePath = join(root, "trace.json");
    await writeFile(tracePath, JSON.stringify({
      schema: "tonolith-trace-v2",
      evidence: "local-emulator",
      network: "local",
      runId: hash,
      coreIds: [0],
      programId: hash,
      romRoot: hash,
      routeRoot: hash,
      staticCommitment: hash,
      frames: [{ index: 0, coreId: 0, before: state, after: state, phase: "none" }],
      unresolved: [],
    }), "utf8");
    const rendered = await capture((io) => runCli(["trace", "local-core", "--format", "json", "--input", tracePath], io));
    assert.equal(rendered.code, 0);
    assert.equal((JSON.parse(rendered.stdout) as { readonly schema: string }).schema, "tonolith-trace-v2");

    const invalidPath = join(root, "invalid-trace.json");
    await writeFile(invalidPath, JSON.stringify({ schema: "wrong" }), "utf8");
    const invalid = await capture((io) => runCli(["trace", "local-core", "--format", "json", "--input", invalidPath], io));
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /unsupported trace schema/);

    const replayManifest = join(root, "run.json");
    const address = `0:${"11".repeat(32)}`;
    await writeFile(replayManifest, JSON.stringify({
      address,
      expectations: {
        address,
        network: "testnet",
        codeHash: hash,
        dataHash: hash,
        stateInitHash: hash,
        programId: hash,
        runId: hash,
        romRoot: hash,
        routeRoot: hash,
        staticCommitment: hash,
      },
      sources: [],
    }), "utf8");
    const replay = await capture((io) => runCli(["replay", replayManifest, "--network", "testnet"], io));
    assert.equal(replay.code, 1);
    assert.match(replay.stdout, /independent replay evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function capture(operation: (io: CliIo) => Promise<number>): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) };
  const code = await operation(io);
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}
