import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makeBenchmarkArtifact, runArtifact, runTwoCorePipeline } from "../../packages/benchmarks/src/index.js";

const compiler = { name: "tonolith-assembler", version: "2.0.0-test", gitCommit: "f".repeat(40), node: "v26.7.0" };
const sameRunId = "aa".repeat(32);

async function source(name: string): Promise<string> {
  return readFile(new URL(`../../programs/v2/${name}`, import.meta.url), "utf8");
}

test("v2 benchmark suite produces the canonical Fibonacci vector", async () => {
  const artifact = makeBenchmarkArtifact(await source("fibonacci.tasm"), "fibonacci-v2", { compiler });
  const result = runArtifact(artifact);
  assert.deepEqual(result.outputs, [1, 1, 2, 3, 5, 8, 13]);
  assert.equal(result.finalStatus, 3);
  assert.equal(result.frames.length, result.executedInstructions);
});

test("v2 bounded checksum and cellular automaton terminate with deterministic outputs", async () => {
  const checksum = runArtifact(makeBenchmarkArtifact(await source("crc4.tasm"), "crc4", { compiler }));
  const automaton = runArtifact(makeBenchmarkArtifact(await source("cellular-automaton.tasm"), "cellular", { compiler }));
  assert.deepEqual(checksum.outputs, [5]);
  assert.equal(automaton.outputs.length, 1);
  assert.ok(automaton.executedInstructions > checksum.executedInstructions);
});

test("two-core counter pipeline authenticates delivery, deduplicates through ACK, and preserves outputs", async () => {
  const routes = [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 16 }];
  const peers = [{ coreId: 0, address: `0:${"10".repeat(32)}` }, { coreId: 1, address: `0:${"11".repeat(32)}` }];
  const sourceArtifact = makeBenchmarkArtifact(await source("counter-source.tasm"), "counter-source", { compiler, coreId: 0, runId: sameRunId, routes, peers });
  const destinationArtifact = makeBenchmarkArtifact(await source("counter-sink.tasm"), "counter-sink", { compiler, coreId: 1, runId: sameRunId, routes, peers });
  const result = runTwoCorePipeline(sourceArtifact, destinationArtifact);
  assert.deepEqual(result.deliveredValues, [1, 2]);
  assert.equal(result.acknowledgements, 2);
});

test("two 4-bit cores implement the carry half of an 8-bit addition", async () => {
  const routes = [
    { sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 16 },
    { sourceCoreId: 0, sourcePort: 1, destinationCoreId: 1, destinationPort: 1, delay: 1, maxRecordsPerEpoch: 16 },
  ];
  const peers = [{ coreId: 0, address: `0:${"20".repeat(32)}` }, { coreId: 1, address: `0:${"21".repeat(32)}` }];
  const low = makeBenchmarkArtifact(await source("add8-low.tasm"), "add8-low", { compiler, coreId: 0, runId: sameRunId, routes, peers });
  const high = makeBenchmarkArtifact(await source("add8-high.tasm"), "add8-high", { compiler, coreId: 1, runId: sameRunId, routes, peers });
  const result = runTwoCorePipeline(low, high);
  assert.deepEqual(result.deliveredValues, [1]);
  assert.equal(result.acknowledgements, 2);
});
