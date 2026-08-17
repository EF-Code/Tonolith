import assert from "node:assert/strict";
import test from "node:test";
import { buildArtifact } from "../../packages/artifact/src/manifest.js";
import { runKeeperOnce, planNextAction } from "../../packages/keeper/src/index.js";
import { STATUS } from "../../packages/isa/src/constants.js";

const artifact = buildArtifact("NOP\n", { name: "keeper-fixture", compiler: { name: "tonolith-assembler", version: "2.0.0-test", gitCommit: "d".repeat(40), node: "v26.7.0" } });
const base = {
  address: "0:" + "12".repeat(32),
  runId: artifact.manifest.runId,
  codeHash: "ab".repeat(32),
  network: "testnet" as const,
  artifactMaxInstructions: 1,
  artifactMaxOutputs: 16,
  maxInstructions: 1,
  maxOutputs: 1,
  advanceValueNano: 10_000_000n,
  dispatchValueNano: 20_000_000n,
};

function observation(overrides: Partial<Parameters<typeof planNextAction>[1]> = {}) {
  return {
    address: base.address,
    network: "testnet" as const,
    codeHash: base.codeHash,
    runId: base.runId,
    stateHash: "ef".repeat(32),
    advanceCount: 4n,
    status: STATUS.running,
    pendingOutputs: [],
    inputCount: 0n,
    ...overrides,
  };
}

test("keeper prioritizes pending delivery and binds the observed state", () => {
  const action = planNextAction(base, observation({ pendingOutputs: [{ outputId: "01".repeat(32) }] }));
  assert.equal(action?.kind, "dispatchOutput");
  assert.equal(action?.reason, "delivery-priority");
  assert.equal(action?.expectedStateHash, "ef".repeat(32));
});

test("keeper plans a single bounded advance only for a fresh runnable core", () => {
  const action = planNextAction(base, observation());
  assert.equal(action?.kind, "advance");
  assert.equal(action?.expectedAdvanceCount, 4n);
  assert.throws(() => planNextAction(base, observation({ codeHash: "cd".repeat(32) })), /code hash mismatch/);
  assert.throws(() => planNextAction({ ...base, maxInstructions: 2 }, observation()), /exceeds artifact limit/);
  assert.equal(planNextAction(base, observation({ status: STATUS.waitingInput })), undefined);
});

test("keeper runner is read-only without a wallet and never retries unknown submission state", async () => {
  const provider = { id: "fixture-a", readCore: async () => observation() };
  const planned = await runKeeperOnce(base, provider);
  assert.equal(planned.action?.kind, "advance");
  assert.equal(planned.wallet, undefined);
  let submitted = 0;
  const result = await runKeeperOnce(base, provider, {
    id: "wallet-fixture",
    submitInternal: async () => { submitted += 1; return { acceptedByRpc: false }; },
    waitForFinality: async () => ({ finalized: false }),
  });
  assert.equal(submitted, 1);
  assert.equal(result.finalized, false);
  assert.match(result.errors[0] ?? "", /no retry/);
});
