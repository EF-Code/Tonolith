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
      worstCaseGas: number;
      worstCaseTraceGas: number;
      hardCeilingPass: boolean;
      testnet40PercentPass: boolean | null;
    }[];
  };
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.maxSteps), [1, 2, 4, 8, 16, 32, 64]);
  assert.equal(matrix.selectedMaxStepsPerAdvance, 1);
  assert.equal(matrix.selectionStatus, "conservative-single-step-until-testnet-gas-baseline");
  assert.ok(matrix.candidates.every((candidate) => candidate.contractAccepted));
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.worstCaseGas), [47997, 47997, 61924, 113797, 209075, 364979, 677438]);
  assert.deepEqual(matrix.candidates.map((candidate) => candidate.worstCaseTraceGas), [48306, 48306, 62233, 114106, 209384, 365288, 677747]);
  assert.ok(matrix.candidates.slice(0, 6).every((candidate) => candidate.hardCeilingPass));
  assert.equal(matrix.candidates[6]?.hardCeilingPass, false);
  assert.ok(matrix.candidates.every((candidate) => candidate.testnet40PercentPass === null));
});
