import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v2 batch selection records every measured candidate and keeps deployment conservative", async () => {
  const matrix = JSON.parse(await readFile(new URL("../../benchmarks/v2/batch-selection.json", import.meta.url), "utf8")) as {
    selectedMaxStepsPerAdvance: number;
    selectionStatus: string;
    candidates: readonly {
      maxSteps: number;
      decision: string;
      contractAccepted: boolean;
      worstCaseGas: number | null;
      worstCaseTraceGas: number | null;
      hardCeilingPass: boolean | null;
      testnet40PercentPass: boolean | null;
    }[];
  };
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.maxSteps), [1, 2, 4, 8, 16, 32, 64]);
  assert.equal(matrix.selectedMaxStepsPerAdvance, 1);
  assert.equal(matrix.selectionStatus, "conservative-single-step-until-explicit-batch-benchmark");
  assert.equal(matrix.candidates[0]?.contractAccepted, true);
  assert.equal(matrix.candidates[0]?.worstCaseGas, 47182);
  assert.equal(matrix.candidates[0]?.worstCaseTraceGas, 47491);
  assert.equal(matrix.candidates[0]?.hardCeilingPass, true);
  assert.ok(matrix.candidates.slice(1).every((candidate) => !candidate.contractAccepted));
  assert.ok(matrix.candidates.slice(1).every((candidate) => candidate.worstCaseGas === null));
  assert.ok(matrix.candidates.slice(1).every((candidate) => candidate.hardCeilingPass === null));
  assert.ok(matrix.candidates.every((candidate) => candidate.testnet40PercentPass === null));
});
