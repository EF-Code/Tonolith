import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { executeInstruction } from "../tools/emulator/emulator.js";
import { romRootHash, staticCommitment } from "../tools/rom/rom.js";
import { createInitialState, stateHash } from "../tools/isa/types.js";

const ROM = [
  0x100f, 0x3000, 0x1001, 0x4000,
  0x5000, 0x6000, 0x7000, 0x8000,
  0x9000, 0xf003, 0xf002, 0xf004,
  0xf005, 0xf006, 0xf007, 0xf008,
];

test("Acton contract trace agrees with the TypeScript emulator", { timeout: 120_000 }, () => {
  let stdout: string;
  try {
    stdout = execFileSync("acton", ["script", "scripts/differential.tolk"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 110_000,
    });
  } catch (error) {
    // The desktop sandbox can report EPERM after the child has completed with
    // status 0. Preserve its captured stdout in that narrow, successful case.
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 0 &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      stdout = error.stdout;
    } else {
      assert.fail(error instanceof Error ? error.message : String(error));
    }
  }

  const traceLines = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TRACE|"));
  const trace2Lines = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TRACE2|"));
  const romLine = stdout.split(/\r?\n/).find((line) => line.startsWith("ROM|"));
  assert.ok(romLine, stdout);
  const [, contractRomHash, contractStaticCommitment] = romLine.split("|");
  assert.equal(BigInt(contractRomHash!), romRootHash(ROM));
  assert.equal(BigInt(contractStaticCommitment!), staticCommitment(ROM));
  assert.equal(traceLines.length, ROM.length, stdout);
  assert.equal(trace2Lines.length, ROM.length, stdout);

  let state = createInitialState();
  for (const [index, traceLine] of traceLines.entries()) {
    const step = executeInstruction(state, ROM).state;
    step.advanceCount += 1n;
    state = step;
    const fields = [
      ...traceLine.split("|"),
      ...trace2Lines[index]!.split("|").slice(1),
    ];
    assert.deepEqual(fields, [
      "TRACE",
      state.advanceCount.toString(),
      state.instructionCount.toString(),
      state.pc.toString(),
      state.accumulator.toString(),
      state.flags.toString(),
      state.status === "halted" ? "1" : "0",
      packRegisters(state.registers).toString(),
      state.outputCount.toString(),
      BigInt(`0x${stateHash(state)}`).toString(),
    ], `differential mismatch at instruction ${index}`);
  }
});

function packRegisters(registers: readonly number[]): bigint {
  return registers.reduce((packed, value, index) => packed | (BigInt(value) << BigInt(index * 4)), 0n);
}
