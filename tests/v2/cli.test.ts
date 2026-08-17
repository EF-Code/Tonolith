import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { beginCell } from "@ton/core";
import { buildArtifact } from "../../packages/artifact/src/manifest.js";
import { buildV2StateInitFromArtifact } from "../../packages/sdk/src/stateinit.js";
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

test("v2 CLI covers artifact inspection, StateInit planning, traces, keeper, and failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tonolith-v2-cli-boundaries-"));
  try {
    const source = join(root, "program.tasm");
    const artifact = join(root, "artifact");
    const codePath = join(root, "code.boc");
    await writeFile(source, ".entry start\nstart:\nLDI 1\nHALT\n", "utf8");
    const assembled = await capture((io) => runCli(["assemble", source, "--out", artifact], io));
    assert.equal(assembled.code, 0);

    const artifactInspection = await capture((io) => runCli(["inspect", artifact], io));
    assert.equal(artifactInspection.code, 0);
    assert.equal((JSON.parse(artifactInspection.stdout) as { readonly kind: string }).kind, "artifact");

    const code = beginCell().storeUint(1, 1).endCell();
    await writeFile(codePath, code.toBoc({ idx: false }));
    const bocInspection = await capture((io) => runCli(["inspect", codePath], io));
    assert.equal(bocInspection.code, 0);
    assert.equal((JSON.parse(bocInspection.stdout) as { readonly kind: string }).kind, "boc");

    const derived = await capture((io) => runCli(["derive-address", artifact, "--network", "testnet", "--code-boc", codePath], io));
    assert.equal(derived.code, 0);
    const derivedJson = JSON.parse(derived.stdout) as { readonly address: string; readonly initialStateHash: string };
    assert.ok(derivedJson.address.length > 10);
    assert.equal(derivedJson.initialStateHash.length, 64);

    const deployRun = join(root, "deploy.json");
    await writeFile(deployRun, JSON.stringify({ artifactDir: artifact, codeBoc: codePath, requiredBalanceNano: "700000000" }), "utf8");
    const deployPlan = await capture((io) => runCli(["deploy-plan", deployRun, "--network", "testnet"], io));
    assert.equal(deployPlan.code, 0);
    assert.equal((JSON.parse(deployPlan.stdout) as { readonly requiredBalanceNano: string }).requiredBalanceNano, "700000000");

    const tracePath = join(root, "trace.json");
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
    const trace = {
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
    };
    await writeFile(tracePath, JSON.stringify(trace), "utf8");
    const textTrace = await capture((io) => runCli(["trace", "local-core", "--format", "text", "--input", tracePath], io));
    assert.equal(textTrace.code, 0);
    assert.match(textTrace.stdout, /"schema": "tonolith-trace-v2"/);
    const ndjsonTrace = await capture((io) => runCli(["trace", "local-core", "--format", "ndjson", "--input", tracePath], io));
    assert.equal(ndjsonTrace.code, 0);
    assert.match(ndjsonTrace.stdout, /"schema":"tonolith-trace-v2"/);

    const artifactBundle = buildArtifact("NOP\n", {
      name: "keeper-cli-fixture",
      compiler: { name: "tonolith-assembler", version: "2.0.0-test", gitCommit: "e".repeat(40), node: "v26.7.0" },
    });
    const initial = buildV2StateInitFromArtifact(code, artifactBundle).initialState;
    const keeperConfig = join(root, "keeper.json");
    await writeFile(keeperConfig, JSON.stringify({
      core: {
        address: `0:${"12".repeat(32)}`,
        runId: artifactBundle.manifest.runId,
        codeHash: "ab".repeat(32),
        network: "testnet",
        artifactMaxInstructions: 1,
        artifactMaxOutputs: 16,
        maxInstructions: 1,
        maxOutputs: 1,
        advanceValueNano: "10000000",
        dispatchValueNano: "20000000",
      },
      observation: {
        address: `0:${"12".repeat(32)}`,
        network: "testnet",
        codeHash: "ab".repeat(32),
        runId: artifactBundle.manifest.runId,
        stateHash: "ef".repeat(32),
        advanceCount: "4",
        status: 0,
        pendingOutputs: [],
        inputCount: "0",
      },
      queryId: "9",
    }), "utf8");
    const keeper = await capture((io) => runCli(["keeper", "run", keeperConfig], io));
    assert.equal(keeper.code, 0);
    assert.equal((JSON.parse(keeper.stdout) as { readonly mode: string }).mode, "read-only");
    assert.equal(initial.instructionCount, 0n);

    const benchmarkTestnet = await capture((io) => runCli(["benchmark", "testnet", artifact], io));
    assert.equal(benchmarkTestnet.code, 1);
    assert.match(benchmarkTestnet.stdout, /raw providers are required/);
    const empty = await capture((io) => runCli([], io));
    assert.equal(empty.code, 2);
    const unknown = await capture((io) => runCli(["not-a-command"], io));
    assert.equal(unknown.code, 2);
    const badNetwork = await capture((io) => runCli(["derive-address", artifact, "--network", "mainnet", "--code-boc", codePath], io));
    assert.equal(badNetwork.code, 1);
    assert.match(badNetwork.stderr, /restricted to TON testnet/);
    const badInspect = await capture((io) => runCli(["inspect", join(root, "missing.boc")], io));
    assert.equal(badInspect.code, 1);
    const badArtifact = await capture((io) => runCli(["verify-artifact", join(root, "missing-artifact")], io));
    assert.equal(badArtifact.code, 1);
    assert.equal((JSON.parse(badArtifact.stdout) as { readonly valid: boolean }).valid, false);
    const badTrace = await capture((io) => runCli(["trace", "local-core", "--format", "bad", "--input", tracePath], io));
    assert.equal(badTrace.code, 2);

    const replayInitial = {
      ...initial,
      advanceCount: "0",
      acceptedMessageCount: "0",
      instructionCount: "0",
      outputCount: "0",
      inputCount: "0",
      epoch: "0",
      ram: Array.from(initial.ram),
      registers: [...initial.registers],
      nextOutputSequence: [...initial.nextOutputSequence],
      inbox: [],
      outbox: [],
    };
    const runManifest = join(root, "run-manifest.json");
    const expectations = {
      address: `0:${"12".repeat(32)}`,
      network: "testnet",
      codeHash: "ab".repeat(32),
      dataHash: "cd".repeat(32),
      stateInitHash: "ef".repeat(32),
      programId: artifactBundle.manifest.programId,
      runId: artifactBundle.manifest.runId,
      romRoot: artifactBundle.manifest.romRoot,
      routeRoot: artifactBundle.manifest.routeRoot,
      staticCommitment: artifactBundle.manifest.staticCommitment,
    };
    await writeFile(runManifest, JSON.stringify({ address: expectations.address, expectations, sources: [], replay: { rom: artifactBundle.assembly.words, initialState: replayInitial } }), "utf8");
    const verifyRun = await capture((io) => runCli(["verify-run", runManifest, "--network", "testnet"], io));
    assert.equal(verifyRun.code, 1);
    assert.match(verifyRun.stdout, /at least two independent sources/);
    const replay = await capture((io) => runCli(["replay", runManifest, "--network", "testnet"], io));
    assert.equal(replay.code, 1);
    assert.match(replay.stdout, /at least two independent sources/);

    for (const argv of [
      ["assemble"], ["inspect"], ["verify-artifact"], ["derive-address"], ["deploy-plan"], ["verify-run"], ["replay"],
      ["trace", "core"], ["keeper"], ["benchmark"], ["benchmark", "local"], ["benchmark", "unknown", artifact],
    ]) {
      const missing = await capture((io) => runCli(argv, io));
      assert.equal(missing.code, 2, argv.join(" "));
    }
    const missingTraceInput = await capture((io) => runCli(["trace", "core", "--format", "json"], io));
    assert.equal(missingTraceInput.code, 1);
    assert.match(missingTraceInput.stdout, /no raw trace/);
    const badBoc = join(root, "bad.boc");
    await writeFile(badBoc, "not-a-boc", "utf8");
    const malformedBoc = await capture((io) => runCli(["inspect", badBoc], io));
    assert.equal(malformedBoc.code, 1);
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
