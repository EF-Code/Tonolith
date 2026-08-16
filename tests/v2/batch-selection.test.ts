import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v2 batch selection records every candidate and selects only measured single-step execution", async () => {
  const matrix = JSON.parse(await readFile(new URL("../../benchmarks/v2/batch-selection.json", import.meta.url), "utf8")) as {
    selectedMaxStepsPerAdvance: number;
    candidates: readonly { maxSteps: number; decision: string; contractAccepted: boolean }[];
  };
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.maxSteps), [1, 2, 4, 8, 16, 32, 64]);
  assert.equal(matrix.selectedMaxStepsPerAdvance, 1);
  assert.equal(matrix.candidates[0]?.contractAccepted, true);
  assert.ok(matrix.candidates.slice(1).every((candidate) => !candidate.contractAccepted));
});
