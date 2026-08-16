import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assemble } from "../tools/assembler/assembler.js";
import { executeInstruction } from "../tools/emulator/emulator.js";
import { romRootHash, staticCommitment } from "../tools/rom/rom.js";
import { createInitialState, stateHash } from "../tools/isa/types.js";

test("the canonical Fibonacci program emits 1, 1, 2, 3, 5, 8, 13", async () => {
  const source = await readFile(new URL("../programs/fibonacci.tasm", import.meta.url), "utf8");
  const { words } = assemble(source);
  assert.equal(
    romRootHash(words).toString(16).padStart(64, "0"),
    "029ccf15774f680518705bb7c8be4b2ca92f34a4ceb9c963e55609225398c748",
  );
  assert.equal(
    staticCommitment(words).toString(16).padStart(64, "0"),
    "50da71fe389768e885c8258c7f4f4a97b86598738eed974336d527e459024f08",
  );
  let state = createInitialState();
  const outputs: Array<{ value: number; hash: string }> = [];
  for (let step = 0; step < 200 && state.status === "running"; step += 1) {
    const result = executeInstruction(state, words);
    state = result.state;
    state.advanceCount += 1n;
    if (result.output !== undefined) {
      outputs.push({ value: result.output.value, hash: stateHash(state) });
    }
  }

  assert.deepEqual(
    outputs,
    [
      { value: 1, hash: "a17244947c98fe3640ddc9c784c23815477d8d2e3c7c2f4d9d0acea6f4162e4d" },
      { value: 1, hash: "b1b5c09fee57b7fa16d6019423b85da95c2c852cf0702fdba06bfde698da1846" },
      { value: 2, hash: "8db1f2058704d2cd33e74e0925af15f96b74e5651d8d7c9ca6c90643636ec482" },
      { value: 3, hash: "6e9893574c161b2c53e055db356b2c75261bbf61c142f1e8328dafc6daa0efa6" },
      { value: 5, hash: "795cf3b126acb29c570dac5532b9c4d75c03c87c0ec36256d0510208dfda88c8" },
      { value: 8, hash: "d66201811dac47a23779bb362eddd61e9973736a1772074b21bd262a327d66d1" },
      { value: 13, hash: "996a1796bde76007a2ea2670c070bffe31f360fb923bc85084b1c3b9ed4b935b" },
    ],
  );
  assert.equal(state.status, "halted");
  assert.equal(state.advanceCount, 97n);
  assert.equal(stateHash(state), "16925a27b1db66171cebb3d43c74702f06f4a362e302754f24026cca0a6bf2be");
});
