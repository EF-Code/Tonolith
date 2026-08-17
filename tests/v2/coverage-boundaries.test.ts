import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { beginCell, Cell } from "@ton/core";
import {
  decodeAdvanceV2,
  decodeBatchAdvancedV2,
  decodeDispatchOutputV2,
  decodeInputAcceptedV2,
  decodeInputCommittedV2,
  decodeOutputAcknowledgedV2,
  decodeOutputCommittedV2,
  decodeTopUpV2,
  decodeV2Event,
  decodeV2Message,
  encodeAdvanceV2,
  encodeBatchAdvancedV2,
  encodeDeliverInputV2,
  encodeDispatchOutputV2,
  encodeInputAcceptedV2,
  encodeInputCommittedV2,
  encodeOutputAcknowledgedV2,
  encodeOutputCommittedV2,
  encodeTopUpV2,
  encodeV2Event,
  V2AbiError,
} from "../../packages/abi/src/messages.js";
import { buildArtifact, canonicalJson, verifyArtifact, type ArtifactBundle } from "../../packages/artifact/src/manifest.js";
import { deriveRunId, limitsHash, programId, staticCommitment } from "../../packages/artifact/src/commitments.js";
import { normalizeRam, normalizeRom, ramPageCell, romWord } from "../../packages/artifact/src/memory.js";
import { normalizePeers, peerCell } from "../../packages/artifact/src/peers.js";
import { normalizeRoutes } from "../../packages/artifact/src/routes.js";
import { decodeInstruction, disassembleWord, encodeInstruction, encodePortInstruction, encodeTrap, V2IsaError } from "../../packages/isa/src/codec.js";
import { ABI_VERSION, EVENT_PREFIX, MESSAGE_PREFIX, SYS } from "../../packages/isa/src/constants.js";
import { STATUS } from "../../packages/isa/src/constants.js";
import { Opcode } from "../../packages/isa/src/types.js";
import { loadArtifactDirectory, loadArtifactDirectorySync } from "../../packages/sdk/src/node.js";
import { buildV2StateInit, buildV2StateInitFromArtifact } from "../../packages/sdk/src/stateinit.js";
import { coreStateCell, stateHash } from "../../packages/emulator/src/commitments.js";
import { advance } from "../../packages/emulator/src/executor.js";
import { verifyAccount, verifyHistoryContinuity, verifyRunFromSources, verifySnapshotIdentity, parseMessageBody, type RawAccountSnapshot, type RawChainSnapshot, type RawChainSource, type RawTransactionSnapshot, type V2VerificationExpectations } from "../../packages/verifier/src/index.js";
import { encodeTrace, validateTrace, type TonolithTraceV2 } from "../../packages/trace/src/index.js";
import { planNextAction, runKeeperOnce } from "../../packages/keeper/src/index.js";
import type { KeeperCoreConfig, KeeperCoreObservation } from "../../packages/keeper/src/types.js";

const compiler = { name: "tonolith-assembler", version: "2.0.0-test", gitCommit: "e".repeat(40), node: "v26.7.0" };
const h = (digit: string): string => digit.repeat(64);

test("v2 ABI covers every message and event variant plus strict malformed cells", () => {
  const common = { queryId: 7n, runId: h("1") };
  const messages = [
    encodeAdvanceV2({ ...common, expectedAdvanceCount: 2n, expectedStateHash: h("2"), maxInstructions: 1, maxOutputs: 1 }),
    encodeDispatchOutputV2({ ...common, expectedStateHash: h("2"), outputId: h("3") }),
    encodeTopUpV2(common),
    encodeInputAcceptedV2({ ...common, outputId: h("3"), destinationCoreId: 4, destinationEpoch: 5n, destinationStateHash: h("4") }),
  ];
  assert.equal(decodeV2Message(messages[0]!).kind, "advance");
  assert.equal(decodeV2Message(messages[1]!).kind, "dispatchOutput");
  assert.equal(decodeV2Message(messages[2]!).kind, "topUp");
  assert.equal(decodeV2Message(messages[3]!).kind, "inputAccepted");

  const deliver = {
    ...common,
    outputId: h("3"),
    sourceCoreId: 1,
    destinationCoreId: 2,
    sourceEpoch: 3n,
    destinationEpoch: 4n,
    sourcePort: 5,
    destinationPort: 6,
    sequence: 7,
    value: 8,
    sourceInstructionCount: 9n,
    sourceStateHash: h("5"),
  };
  assert.equal(decodeV2Message(encodeDeliverInputV2(deliver)).kind, "deliverInput");

  const events = [
    encodeBatchAdvancedV2({ ...common, coreId: 1, advanceCount: 2n, epoch: 3n, startInstructionCount: 4n, endInstructionCount: 5n, stepsExecuted: 1, outputsProduced: 0, stopReason: 0, previousStateHash: h("2"), nextStateHash: h("3"), batchCommitment: h("4"), finalPc: 6, finalStatus: 0 }),
    encodeOutputCommittedV2({ ...common, outputId: h("2"), sourceCoreId: 1, destinationCoreId: 2, epoch: 3n, sourcePort: 4, destinationPort: 5, sequence: 6, value: 7, outputCommitment: h("3") }),
    encodeInputCommittedV2({ ...common, outputId: h("2"), sourceCoreId: 1, destinationCoreId: 2, epoch: 3n, destinationPort: 4, sequence: 5, inputCommitment: h("3") }),
    encodeOutputAcknowledgedV2({ ...common, outputId: h("2"), destinationCoreId: 2, destinationEpoch: 3n, outputCommitment: h("3") }),
  ];
  assert.equal(decodeV2Event(events[0]!).kind, "batchAdvanced");
  assert.equal(decodeV2Event(events[1]!).kind, "outputCommitted");
  assert.equal(decodeV2Event(events[2]!).kind, "inputCommitted");
  assert.equal(decodeV2Event(events[3]!).kind, "outputAcknowledged");
  for (const event of events) assert.doesNotThrow(() => decodeV2Event(event.beginParse()));
  assert.doesNotThrow(() => encodeV2Event({ kind: "batchAdvanced", queryId: 1n, runId: h("1"), coreId: 0, advanceCount: 0n, epoch: 0n, startInstructionCount: 0n, endInstructionCount: 1n, stepsExecuted: 1, outputsProduced: 0, stopReason: 0, previousStateHash: h("1"), nextStateHash: h("2"), batchCommitment: h("3"), finalPc: 0, finalStatus: 0 }));
  assert.doesNotThrow(() => encodeV2Event({ kind: "outputCommitted", queryId: 1n, runId: h("1"), outputId: h("2"), sourceCoreId: 0, destinationCoreId: 1, epoch: 0n, sourcePort: 0, destinationPort: 0, sequence: 0, value: 1, outputCommitment: h("3") }));
  assert.doesNotThrow(() => encodeV2Event({ kind: "inputCommitted", queryId: 1n, runId: h("1"), outputId: h("2"), sourceCoreId: 0, destinationCoreId: 1, epoch: 0n, destinationPort: 0, sequence: 0, inputCommitment: h("3") }));
  assert.doesNotThrow(() => encodeV2Event({ kind: "outputAcknowledged", queryId: 1n, runId: h("1"), outputId: h("2"), destinationCoreId: 1, destinationEpoch: 0n, outputCommitment: h("3") }));

  assert.throws(() => decodeV2Message(beginCell().endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "SHORT_BODY");
  assert.throws(() => decodeV2Message(beginCell().storeUint(0xffffffff, 32).endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "UNKNOWN_PREFIX");
  assert.throws(() => decodeAdvanceV2(beginCell().storeUint(MESSAGE_PREFIX.advance, 32).endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "SHORT_BODY");
  assert.throws(() => decodeAdvanceV2(encodeAdvanceV2({ ...common, expectedAdvanceCount: 0n, expectedStateHash: h("2"), maxInstructions: 0, maxOutputs: 1 })), /maxInstructions/);
  assert.throws(() => decodeTopUpV2(beginCell().storeUint(MESSAGE_PREFIX.topUp, 32).storeUint(ABI_VERSION, 16).storeUint(0, 64).storeUint(0, 256).storeUint(1, 1).endCell()), /trailing/);
  assert.throws(() => encodeTopUpV2({ ...common, runId: "bad" }), (error: unknown) => error instanceof V2AbiError && error.code === "INVALID_FIELD");
  assert.throws(() => decodeV2Event(beginCell().storeUint(EVENT_PREFIX.batchAdvanced, 32).endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "SHORT_BODY");
  assert.throws(() => decodeV2Event(beginCell().storeUint(0xffffffff, 32).endCell()), (error: unknown) => error instanceof V2AbiError && error.code === "UNKNOWN_PREFIX");
});

test("v2 ISA accepts every display form and rejects malformed canonical words", () => {
  const words = [
    encodeInstruction(Opcode.NOP), encodeInstruction(Opcode.LDI, 15), encodeInstruction(Opcode.LDR, 15), encodeInstruction(Opcode.STR, 0),
    encodeInstruction(Opcode.ADD, 1), encodeInstruction(Opcode.ADC, 2), encodeInstruction(Opcode.SUB, 3), encodeInstruction(Opcode.AND, 4),
    encodeInstruction(Opcode.OR, 5), encodeInstruction(Opcode.XOR, 6), encodeInstruction(Opcode.LDM, 255), encodeInstruction(Opcode.STM, 0),
    encodeInstruction(Opcode.JMP, 1023), encodeInstruction(Opcode.JZ, 1022), encodeInstruction(Opcode.JC, 1021),
    encodeInstruction(Opcode.SYS, SYS.HALT), encodeInstruction(Opcode.SYS, SYS.OUT), encodeInstruction(Opcode.SYS, SYS.CLC),
    encodeInstruction(Opcode.SYS, SYS.STC), encodeInstruction(Opcode.SYS, SYS.NOT), encodeInstruction(Opcode.SYS, SYS.SHL),
    encodeInstruction(Opcode.SYS, SYS.SHR), encodeInstruction(Opcode.SYS, SYS.INC), encodeInstruction(Opcode.SYS, SYS.DEC),
    encodePortInstruction(SYS.IN, 0), encodePortInstruction(SYS.OUTP, 15), encodeInstruction(Opcode.SYS, SYS.YIELD), encodeTrap(255),
  ];
  assert.equal(words.length, 28);
  for (const word of words) assert.equal(decodeInstruction(word).word, word);
  assert.equal(disassembleWord(words[0]!), "NOP");
  assert.equal(disassembleWord(words[1]!), "LDI 0xF");
  assert.equal(disassembleWord(words[2]!), "LDR R15");
  assert.equal(disassembleWord(words[10]!), "LDM 0xFF");
  assert.equal(disassembleWord(words[12]!), "JMP 0x3FF");
  assert.equal(disassembleWord(words[24]!), "IN 0");
  assert.equal(disassembleWord(words[25]!), "OUTP 15");
  assert.equal(disassembleWord(words[27]!), "TRAP 0xFF");
  assert.throws(() => encodeInstruction(Opcode.NOP, 1.5), (error: unknown) => error instanceof V2IsaError && error.code === "INVALID_OPERAND");
  assert.throws(() => encodeInstruction(Opcode.NOP, -1), /12-bit/);
  assert.throws(() => encodeInstruction(Opcode.NOP, 4096), /12-bit/);
  assert.throws(() => encodeInstruction(99 as Opcode), /unknown opcode/);
  assert.throws(() => decodeInstruction(-1), /16-bit/);
  assert.throws(() => decodeInstruction(0x10000), /16-bit/);
  assert.throws(() => decodeInstruction(0x0001), (error: unknown) => error instanceof V2IsaError && error.code === "NON_CANONICAL");
  assert.throws(() => decodeInstruction(0xf00d), /reserved SYS/);
  assert.throws(() => encodePortInstruction(SYS.IN, -1), /port/);
  assert.throws(() => encodeTrap(-1), /TRAP/);
  assert.throws(() => encodeTrap(256), /TRAP/);
});

test("artifact memory, route, peer, and commitment boundaries are fail-closed", () => {
  assert.throws(() => normalizeRom(new Array(1025).fill(0)), /maximum/);
  assert.throws(() => normalizeRom([Number.NaN]), /16-bit/);
  assert.throws(() => normalizeRom([-1]), /16-bit/);
  assert.throws(() => normalizeRom([0x10000]), /16-bit/);
  assert.throws(() => romWord([], -1), /ROM address/);
  assert.throws(() => romWord([], 1024), /ROM address/);
  assert.equal(romWord([0x1234], 1), 0);
  assert.throws(() => normalizeRam(new Array(257).fill(0)), /maximum/);
  assert.throws(() => normalizeRam([Number.NaN]), /0..15/);
  assert.throws(() => normalizeRam([-1]), /0..15/);
  assert.throws(() => normalizeRam([16]), /0..15/);
  assert.throws(() => ramPageCell([], -1), /RAM page/);
  assert.throws(() => ramPageCell([], 4), /RAM page/);

  const address = "0:" + "12".repeat(32);
  assert.equal(normalizePeers([{ coreId: 2, address }])[0]?.address, address);
  assert.throws(() => normalizePeers(new Array(17).fill({ coreId: 0, address })), /at most/);
  assert.throws(() => normalizePeers([{ coreId: -1, address }]), /coreId/);
  assert.throws(() => normalizePeers([{ coreId: 65536, address }]), /coreId/);
  assert.throws(() => normalizePeers([{ coreId: 1, address }, { coreId: 1, address }]), /duplicate/);
  assert.doesNotThrow(() => peerCell({ coreId: 0, address }));

  const route = { sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 1, delay: 1, maxRecordsPerEpoch: 1 };
  assert.throws(() => normalizeRoutes(new Array(17).fill(route)), /at most/);
  for (const bad of [
    { ...route, sourceCoreId: -1 }, { ...route, destinationCoreId: 65536 }, { ...route, sourcePort: -1 },
    { ...route, destinationPort: 16 }, { ...route, delay: 0 }, { ...route, delay: 256 },
    { ...route, maxRecordsPerEpoch: 0 }, { ...route, maxRecordsPerEpoch: 17 },
  ]) assert.throws(() => normalizeRoutes([bad]), /route|source|destination|maxRecords/);

  const ids = [h("1")];
  assert.match(deriveRunId(ids, h("3"), h("4")), /^[0-9a-f]{64}$/);
  const twoCoreRun = deriveRunId([h("1"), h("2")], h("3"), h("4"));
  assert.match(twoCoreRun, /^[0-9a-f]{64}$/);
  assert.notEqual(twoCoreRun, deriveRunId([h("2"), h("1")], h("3"), h("4")));
  assert.match(deriveRunId(new Array(255).fill(h("1")), h("3"), h("4")), /^[0-9a-f]{64}$/);
  assert.throws(() => deriveRunId([], h("3"), h("4")), /1..255/);
  assert.throws(() => deriveRunId(new Array(256).fill(h("1")), h("3"), h("4")), /1..255/);
  assert.throws(() => programId({ artifactVersion: 2, isaVersion: 2, wordBits: 16, romWords: 1024, ramNibbles: 256, entryPc: 0, romRoot: "bad", initialRamRoot: h("1") }), /commitment/);
  assert.match(limitsHash({ maxStepsPerAdvance: 1, maxInputRecords: 1, maxOutputRecords: 1, maxActionsPerAdvance: 1, maxOutputsPerAdvance: 1 }), /^[0-9a-f]{64}$/);
  assert.throws(() => staticCommitment({ schemaVersion: 2, isaVersion: 2, abiVersion: 2, protocolVersion: 2, runId: h("1"), coreId: 0, programId: h("2"), romRoot: h("3"), routeRoot: h("4"), limitsHash: "bad" }), /commitment/);
  assert.match(staticCommitment({ schemaVersion: 2, isaVersion: 2, abiVersion: 2, protocolVersion: 2, runId: h("1"), coreId: 0, programId: h("2"), romRoot: h("3"), routeRoot: h("4"), limitsHash: h("5") }), /^[0-9a-f]{64}$/);
});

test("artifact verification exercises canonical metadata and limit rejection paths", () => {
  const artifact = buildArtifact(".entry 0\nNOP\n", { name: "boundary-artifact", compiler });
  const mutate = (changes: Partial<ArtifactBundle["manifest"]>, files = artifact.files): ArtifactBundle => ({ ...artifact, manifest: { ...artifact.manifest, ...changes }, files });
  for (const field of ["artifactVersion", "schemaVersion", "isaVersion", "abiVersion", "protocolVersion"] as const) {
    assert.equal(verifyArtifact(mutate({ [field]: 1 } as never)).valid, false);
  }
  for (const field of ["runId", "runSalt", "romRoot", "initialRamRoot", "routeRoot", "peerRoot", "programId", "limitsHash", "staticCommitment", "sourceHash"] as const) {
    assert.match(verifyArtifact(mutate({ [field]: "X" } as never)).errors.join("\n"), new RegExp(field));
  }
  assert.match(verifyArtifact(mutate({ entryPc: 1 })).errors.join("\n"), /entryPc/);
  assert.equal(verifyArtifact(mutate({ coreId: -1 })).valid, false);
  assert.match(verifyArtifact(mutate({}, { ...artifact.files, "artifact.json": "{}" })).errors.join("\n"), /artifact.json/);
  assert.equal(verifyArtifact(mutate({}, Object.fromEntries(Object.entries(artifact.files).filter(([name]) => name !== "artifact.json")))).valid, true);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
  for (const [field, value] of [["maxStepsPerAdvance", 0], ["maxStepsPerAdvance", 0x10000], ["maxInputRecords", 0], ["maxInputRecords", 17], ["maxOutputRecords", 0], ["maxOutputRecords", 17], ["maxActionsPerAdvance", 0], ["maxActionsPerAdvance", 33], ["maxOutputsPerAdvance", 0], ["maxOutputsPerAdvance", 17]] as const) {
    assert.throws(() => buildArtifact("NOP\n", { name: "bad-limit", compiler, limits: { [field]: value } }), new RegExp(field));
  }
});

test("artifact defaults remain canonical when optional metadata is omitted", () => {
  const artifact = buildArtifact("NOP\n", { name: "default-metadata" });
  assert.equal(verifyArtifact(artifact).valid, true);
  assert.equal(artifact.manifest.description, "");
  assert.equal(artifact.manifest.coreId, 0);
});

test("trace validation covers evidence, frame continuity, optional metadata, and state bounds", () => {
  const state = {
    stateHash: h("1"), pc: 0, accumulator: 0, flags: 0, epoch: "0", instructionCount: "0", advanceCount: "0", status: 0,
    outputCommitment: h("2"), inputCommitment: h("3"), inboxCount: 0, outboxCount: 0,
  };
  const frame = {
    index: 0, coreId: 0, instructionWord: 0, opcode: 0, sourceLine: 1, before: state,
    after: { ...state, stateHash: h("4"), instructionCount: "1", advanceCount: "1" }, phase: "finalized" as const,
    outputId: h("5"), transactionHash: h("6"), transactionFinalized: true, note: "verified",
  };
  const base: TonolithTraceV2 = {
    schema: "tonolith-trace-v2", evidence: "local-emulator", network: "local", runId: h("7"), coreIds: [0],
    programId: h("8"), romRoot: h("9"), routeRoot: h("a"), staticCommitment: h("b"), frames: [frame], unresolved: [],
  };
  assert.doesNotThrow(() => validateTrace(base));
  for (const evidence of ["local-emulator", "acton-sandbox", "local-validator"] as const) {
    assert.doesNotThrow(() => validateTrace({ ...base, evidence, network: "local" }));
  }
  assert.doesNotThrow(() => validateTrace({ ...base, evidence: "testnet", network: "testnet" }));
  assert.equal(typeof encodeTrace(base), "string");

  const bad = (value: unknown, pattern: RegExp) => assert.throws(() => validateTrace(value), pattern);
  bad(null, /trace must be an object/);
  bad({ ...base, schema: "v1" }, /unsupported trace schema/);
  bad({ ...base, evidence: "unknown" }, /invalid trace evidence/);
  bad({ ...base, evidence: undefined }, /invalid trace evidence/);
  bad({ ...base, network: "unknown" }, /invalid trace network/);
  bad({ ...base, evidence: "testnet", network: "local" }, /testnet evidence/);
  bad({ ...base, evidence: "local-emulator", network: "testnet" }, /local evidence/);
  for (const field of ["runId", "programId", "romRoot", "routeRoot", "staticCommitment"] as const) bad({ ...base, [field]: "bad" }, /invalid trace/);
  bad({ ...base, frames: {}, }, /frames and coreIds/);
  bad({ ...base, coreIds: {} }, /frames and coreIds/);
  bad({ ...base, coreIds: [0, 0] }, /core IDs must be unique/);
  bad({ ...base, coreIds: [65536] }, /trace core ID/);
  bad({ ...base, unresolved: [1] }, /unresolved/);
  bad({ ...base, frames: [{ ...frame, index: -1 }] }, /frame index/);
  bad({ ...base, frames: [{ ...frame, coreId: 1 }] }, /not declared/);
  bad({ ...base, frames: [{ ...frame, instructionWord: 65536 }] }, /instruction word/);
  bad({ ...base, frames: [{ ...frame, opcode: 16 }] }, /trace opcode/);
  bad({ ...base, frames: [{ ...frame, sourceLine: -1 }] }, /source line/);
  bad({ ...base, frames: [{ ...frame, phase: "bad" }] }, /message phase/);
  bad({ ...base, frames: [{ ...frame, outputId: "bad" }] }, /output ID/);
  bad({ ...base, frames: [{ ...frame, transactionHash: "bad" }] }, /transaction hash/);
  bad({ ...base, frames: [{ ...frame, transactionFinalized: "yes" }] }, /finality flag/);
  bad({ ...base, frames: [{ ...frame, note: 1 }] }, /note/);
  const stateFields: Array<[string, unknown, RegExp]> = [
    ["stateHash", "bad", /state hash/], ["pc", 1024, /trace PC/], ["accumulator", 16, /accumulator/], ["flags", 4, /flags/],
    ["epoch", "-1", /epoch/], ["instructionCount", "-1", /instruction count/], ["advanceCount", "-1", /advance count/],
    ["status", 5, /status/], ["outputCommitment", "bad", /output commitment/], ["inputCommitment", "bad", /input commitment/],
    ["inboxCount", 17, /inbox count/], ["outboxCount", 17, /outbox count/],
  ];
  for (const [field, value, pattern] of stateFields) bad({ ...base, frames: [{ ...frame, before: { ...state, [field]: value } }] }, pattern);
  bad({ ...base, frames: [{ ...frame, index: 0 }, { ...frame, index: 0, before: { ...state, stateHash: h("c") }, after: { ...state, stateHash: h("d") } }] }, /strictly increasing/);
  bad({ ...base, frames: [{ ...frame }, { ...frame, index: 1, before: { ...state, stateHash: h("c") } }] }, /does not continue/);
  bad({ ...base, frames: [{ ...frame, after: { ...state, stateHash: h("4"), instructionCount: "0", advanceCount: "0" } }, { ...frame, index: 1, before: { ...state, stateHash: h("4"), instructionCount: "1" }, after: { ...state, stateHash: h("d"), instructionCount: "0", advanceCount: "0" } }] }, /instruction count cannot move backwards/);
  bad({ ...base, frames: [{ ...frame, after: { ...state, stateHash: h("4"), instructionCount: "1", advanceCount: "0" } }, { ...frame, index: 1, before: { ...state, stateHash: h("4"), instructionCount: "1", advanceCount: "1" }, after: { ...state, stateHash: h("d"), instructionCount: "2", advanceCount: "0" } }] }, /advance count cannot move backwards/);
});

test("verifier rejects malformed accounts, histories, and provider setup without throwing", async () => {
  const fixture = makeVerifierFixture();
  const otherAddress = "0:" + "34".repeat(32);
  assert.deepEqual(verifyAccount(fixture.account, fixture.expectations), []);
  assert.match(verifyAccount({ ...fixture.account, address: otherAddress }, fixture.expectations).join("\n"), /account address/);
  assert.match(verifyAccount({ address: fixture.account.address }, fixture.expectations).join("\n"), /code\/data/);
  const { stateInitBoc: _missingStateInit, ...accountWithoutStateInit } = fixture.account;
  assert.match(verifyAccount(accountWithoutStateInit, fixture.expectations).join("\n"), /StateInit/);
  assert.match(verifyAccount({ ...fixture.account, codeBoc: "bad" }, fixture.expectations).join("\n"), /invalid account BOC/);
  assert.match(verifyAccount({ ...fixture.account, stateInitBoc: beginCell().endCell().toBoc({ idx: false }).toString("base64") }, fixture.expectations).join("\n"), /StateInit lacks|invalid account BOC/);
  assert.match(verifyAccount({ ...fixture.account, dataBoc: beginCell().storeUint(1, 1).endCell().toBoc({ idx: false }).toString("base64") }, fixture.expectations).join("\n"), /data hash/);
  assert.match(verifyAccount(fixture.account, { ...fixture.expectations, address: "not-an-address" }).join("\n"), /invalid account address/);

  assert.match(verifyHistoryContinuity([{ hash: "bad", lt: "x", success: true, outbound: [] }]).join("\n"), /hash|logical time/);
  const first = { hash: h("1"), lt: "2", success: true, outbound: [] };
  assert.match(verifyHistoryContinuity([first, { hash: h("1"), lt: "1", success: true, outbound: [] }]).join("\n"), /appears more than once|predecessor hash|logical-time|strictly ordered/);
  assert.match(verifyHistoryContinuity([first, { hash: h("2"), lt: "3", prevTransactionHash: h("x"), prevTransactionLt: "4", success: true, outbound: [] }]).join("\n"), /link mismatch/);
  assert.match(verifyHistoryContinuity([first, { hash: h("2"), lt: "1", prevTransactionHash: h("1"), prevTransactionLt: "2", success: true, outbound: [] }]).join("\n"), /strictly ordered/);

  assert.deepEqual(parseMessageBody({ direction: "in" }), { error: "message body BOC is missing" });
  assert.match(parseMessageBody({ direction: "in", bodyBoc: "bad" }).error ?? "", /invalid v2 message body/);
  assert.match(verifySnapshotIdentity({ ...fixture.snapshot, network: "mainnet" }, fixture.expectations).join("\n"), /network mismatch/);
  assert.match(verifySnapshotIdentity({ ...fixture.snapshot, transactions: [] }, fixture.expectations).join("\n"), /history is empty/);

  const noReplay = await verifyRunFromSources(fixture.expectations.address, fixture.expectations, [sourceFor(fixture.snapshot, "a"), sourceFor(fixture.snapshot, "b")]);
  assert.equal(noReplay.overall, "incomplete");
  const oneSource = await verifyRunFromSources(fixture.expectations.address, fixture.expectations, [sourceFor(fixture.snapshot, "a")]);
  assert.equal(oneSource.overall, "incomplete");
  const duplicateSources = await verifyRunFromSources(fixture.expectations.address, fixture.expectations, [sourceFor(fixture.snapshot, "a"), sourceFor(fixture.snapshot, "a")]);
  assert.equal(duplicateSources.overall, "incomplete");
});

test("verifier replay distinguishes undecodable, stale, dispatch, top-up, and state-evidence outcomes", async () => {
  const fixture = makeVerifierFixture();
  const advanceMessage = encodeAdvanceV2({ queryId: 1n, runId: fixture.artifact.manifest.runId, expectedAdvanceCount: 0n, expectedStateHash: fixture.deployment.initialStateHash, maxInstructions: 1, maxOutputs: 1 });
  const advanced = advance(fixture.deployment.initialState, { rom: fixture.artifact.assembly.words }, { expectedAdvanceCount: 0n, expectedStateHash: fixture.deployment.initialStateHash, maxInstructions: 1, maxOutputs: 1 });
  const dispatch = encodeDispatchOutputV2({ queryId: 2n, runId: fixture.artifact.manifest.runId, expectedStateHash: advanced.nextStateHash, outputId: h("f") });
  const topUp = encodeTopUpV2({ queryId: 3n, runId: fixture.artifact.manifest.runId });
  const tx = (index: number, bodyBoc: string | undefined, success = true): RawTransactionSnapshot => ({
    hash: index.toString(16).padStart(64, "0"), lt: String(index + 1), success, outbound: [],
    ...(index === 0 ? {} : { prevTransactionHash: (index - 1).toString(16).padStart(64, "0"), prevTransactionLt: String(index) }),
    ...(bodyBoc === undefined ? {} : { inbound: { direction: "in" as const, bodyBoc } }),
  });
  const snapshot: RawChainSnapshot = {
    ...fixture.snapshot,
    transactions: [
      tx(0, undefined),
      tx(1, advanceMessage.toBoc({ idx: false }).toString("base64")),
      tx(2, topUp.toBoc({ idx: false }).toString("base64")),
      tx(3, "bad", false),
      tx(4, dispatch.toBoc({ idx: false }).toString("base64")),
    ],
  };
  const replay = { initialState: fixture.deployment.initialState, rom: fixture.artifact.assembly.words };
  const report = await verifyRunFromSources(fixture.expectations.address, fixture.expectations, [sourceFor(snapshot, "a"), sourceFor(snapshot, "b")], replay);
  assert.equal(report.overall, "failed");
  assert.match(report.errors.join("\n"), /post-state BOC|not found|undecodable/);

  const wrongRun = encodeTopUpV2({ queryId: 8n, runId: h("c") });
  const mismatchSnapshot = { ...fixture.snapshot, transactions: [tx(0, undefined), tx(1, wrongRun.toBoc({ idx: false }).toString("base64"), false)] };
  const mismatch = await verifyRunFromSources(fixture.expectations.address, fixture.expectations, [sourceFor(mismatchSnapshot, "a"), sourceFor(mismatchSnapshot, "b")], replay);
  assert.match(mismatch.errors.join("\n"), /run ID mismatch/);

  const badReplay = await verifyRunFromSources(fixture.expectations.address, fixture.expectations, [sourceFor(fixture.snapshot, "a"), sourceFor(fixture.snapshot, "b")], {
    initialState: { ...fixture.deployment.initialState, config: { ...fixture.deployment.initialState.config, runId: h("c") } },
    rom: [],
  });
  assert.match(badReplay.errors.join("\n"), /replay .*does not match|ROM is empty/);
});

interface VerifierFixture {
  readonly artifact: ArtifactBundle;
  readonly deployment: ReturnType<typeof buildV2StateInitFromArtifact>;
  readonly account: RawAccountSnapshot;
  readonly expectations: V2VerificationExpectations;
  readonly snapshot: RawChainSnapshot;
}

function makeVerifierFixture(): VerifierFixture {
  const artifact = buildArtifact(".entry 0\nNOP\n", { name: "coverage-verifier", compiler });
  const deployment = buildV2StateInitFromArtifact(beginCell().storeUint(1, 1).endCell(), artifact);
  const account: RawAccountSnapshot = {
    address: deployment.address.toRawString(),
    codeBoc: deployment.stateInit.code!.toBoc({ idx: false }).toString("base64"),
    dataBoc: deployment.data.toBoc({ idx: false }).toString("base64"),
    stateInitBoc: deployment.stateInitCell.toBoc({ idx: false }).toString("base64"),
  };
  const expectations: V2VerificationExpectations = {
    address: deployment.address.toRawString(), network: "testnet", codeHash: deployment.codeHash, dataHash: deployment.dataHash,
    stateInitHash: deployment.stateInitHash, programId: artifact.manifest.programId, runId: artifact.manifest.runId,
    romRoot: artifact.manifest.romRoot, routeRoot: artifact.manifest.routeRoot, staticCommitment: artifact.manifest.staticCommitment,
  };
  return { artifact, deployment, account, expectations, snapshot: { source: "fixture", network: "testnet", account, transactions: [{ hash: h("0"), lt: "1", success: true, outbound: [] }] } };
}

function sourceFor(snapshot: RawChainSnapshot, id: string): RawChainSource {
  return { id, fetchSnapshot: async () => ({ ...snapshot, source: id }) };
}

test("keeper validation covers identity, limits, queue observations, and wallet finality", async () => {
  const address = "0:" + "56".repeat(32);
  const config: KeeperCoreConfig = {
    address, runId: h("1"), codeHash: h("2"), network: "testnet", artifactMaxInstructions: 1, artifactMaxOutputs: 1,
    maxInstructions: 1, maxOutputs: 1, advanceValueNano: 1n, dispatchValueNano: 2n,
  };
  const observation: KeeperCoreObservation = {
    address, network: "testnet", codeHash: h("2"), runId: h("1"), stateHash: h("3"), advanceCount: 0n,
    status: STATUS.running, pendingOutputs: [], inputCount: 0n,
  };
  const invalid = (changed: Partial<KeeperCoreConfig>, expected: RegExp) => assert.throws(() => planNextAction({ ...config, ...changed }, observation), expected);
  invalid({ address: "bad" }, /invalid core address/);
  invalid({ address: "0:" + "57".repeat(32) }, /address mismatch/);
  invalid({ runId: h("4") }, /run ID mismatch/);
  invalid({ codeHash: h("4") }, /code hash mismatch/);
  invalid({ runId: "bad" }, /run ID mismatch/);
  assert.throws(() => planNextAction({ ...config, runId: "bad" }, { ...observation, runId: "bad" }), /run ID must/);
  assert.throws(() => planNextAction(config, { ...observation, stateHash: "bad" }), /state hash/);
  assert.throws(() => planNextAction({ ...config, artifactMaxInstructions: 0 }, observation), /artifact instruction/);
  assert.throws(() => planNextAction({ ...config, artifactMaxInstructions: 0x10000 }, observation), /artifact instruction/);
  assert.throws(() => planNextAction({ ...config, artifactMaxOutputs: 0 }, observation), /artifact output/);
  assert.throws(() => planNextAction({ ...config, artifactMaxOutputs: 256 }, observation), /artifact output/);
  assert.throws(() => planNextAction({ ...config, maxInstructions: 0 }, observation), /instruction cap/);
  assert.throws(() => planNextAction({ ...config, maxOutputs: 0 }, observation), /output cap/);
  assert.throws(() => planNextAction({ ...config, maxInstructions: 2 }, observation), /exceeds artifact/);
  assert.throws(() => planNextAction({ ...config, maxOutputs: 2 }, observation), /exceeds artifact/);
  assert.throws(() => planNextAction({ ...config, advanceValueNano: 0n }, observation), /values/);
  assert.throws(() => planNextAction({ ...config, dispatchValueNano: 0n }, observation), /values/);
  assert.throws(() => planNextAction(config, { ...observation, advanceCount: -1n }), /advance count/);
  assert.throws(() => planNextAction(config, { ...observation, pendingOutputs: [{ outputId: "bad" }] }), /pending output/);
  assert.throws(() => planNextAction(config, { ...observation, pendingOutputs: [{ outputId: h("4") }, { outputId: h("4") }] }), /duplicate pending/);
  assert.throws(() => planNextAction(config, observation, -1n), /query id/);
  assert.equal(planNextAction(config, { ...observation, status: STATUS.waitingInput }), undefined);
  assert.throws(() => planNextAction(config, { ...observation, pendingOutputs: [undefined] as never[] }), /pending output observation/);
  assert.throws(() => planNextAction(config, { ...observation, network: "mainnet" as never }), /testnet/);
  assert.throws(() => planNextAction({ ...config, network: "mainnet" as never }, observation), /testnet/);

  const provider = { id: "keeper-boundary", readCore: async () => observation };
  const noAction = await runKeeperOnce(config, { id: provider.id, readCore: async () => ({ ...observation, status: STATUS.halted }) });
  assert.equal(noAction.action, undefined);
  const providerError = await runKeeperOnce(config, { id: provider.id, readCore: async () => { throw new Error("provider unavailable"); } });
  assert.match(providerError.errors[0] ?? "", /provider unavailable/);
  const rpcNoHash = await runKeeperOnce(config, provider, { id: "wallet-a", submitInternal: async () => ({ acceptedByRpc: true }), waitForFinality: async () => ({ finalized: true }) });
  assert.match(rpcNoHash.errors[0] ?? "", /no retry/);
  const finalized = await runKeeperOnce(config, provider, { id: "wallet-a", submitInternal: async () => ({ acceptedByRpc: true, transactionHash: h("5") }), waitForFinality: async () => ({ finalized: true, stateHash: h("3") }) });
  assert.equal(finalized.finalized, true);
  const notFinalized = await runKeeperOnce(config, provider, { id: "wallet-a", submitInternal: async () => ({ acceptedByRpc: true, transactionHash: h("5") }), waitForFinality: async () => ({ finalized: false }) });
  assert.equal(notFinalized.finalized, false);
  assert.match(notFinalized.errors[0] ?? "", /finalized/);
});

test("Node SDK and StateInit loaders reject incomplete sidecars and commitment drift", async () => {
  const artifact = buildArtifact(".entry 0\nNOP\n", { name: "loader-boundary", compiler });
  const directory = await mkdtemp(join(tmpdir(), "tonolith-v2-loader-boundary-"));
  try {
    for (const [name, content] of Object.entries(artifact.files)) await writeFile(join(directory, name), content, "utf8");
    await mkdir(join(directory, "ignored-directory"));
    assert.equal((await loadArtifactDirectory(directory)).manifest.name, artifact.manifest.name);
    assert.equal(loadArtifactDirectorySync(directory).manifest.name, artifact.manifest.name);

    const missing = await mkdtemp(join(tmpdir(), "tonolith-v2-loader-missing-"));
    try {
      await writeFile(join(missing, "artifact.json"), "{}", "utf8");
      await assert.rejects(() => loadArtifactDirectory(missing), /artifact is missing/);
      assert.throws(() => loadArtifactDirectorySync(missing), /artifact is missing/);
    } finally {
      await rm(missing, { recursive: true, force: true });
    }
    await writeFile(join(directory, "artifact.json"), "{", "utf8");
    await assert.rejects(() => loadArtifactDirectory(directory), /invalid artifact.json/);
    await writeFile(join(directory, "artifact.json"), artifact.files["artifact.json"]!, "utf8");
    await writeFile(join(directory, "assembly.json"), "{", "utf8");
    await assert.rejects(() => loadArtifactDirectory(directory), /invalid assembly.json/);
    assert.throws(() => loadArtifactDirectorySync(directory), /invalid assembly.json/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const code = beginCell().storeUint(1, 1).endCell();
  const valid = buildV2StateInitFromArtifact(code, artifact);
  assert.equal(valid.address.workChain, 0);
  assert.throws(() => buildV2StateInitFromArtifact(code, { ...artifact, routes: [{ sourceCoreId: 0, sourcePort: 0, destinationCoreId: 1, destinationPort: 0, delay: 1, maxRecordsPerEpoch: 1 }] }), /route root/);
  assert.throws(() => buildV2StateInitFromArtifact(code, { ...artifact, peers: [{ coreId: 1, address: "0:" + "67".repeat(32) }] }), /peer root/);
  assert.throws(() => buildV2StateInit(code, { manifest: { ...artifact.manifest, staticCommitment: h("f") }, rom: valid.stateInit.data!, routes: artifact.routes, peers: artifact.peers }), /static commitment/);
  assert.throws(() => buildV2StateInit(code, { manifest: artifact.manifest, rom: valid.stateInit.code!, routes: artifact.routes, peers: artifact.peers, maxStepsPerAdvance: 2 }), /single-step/);
  assert.throws(() => buildV2StateInit(code, { manifest: artifact.manifest, rom: valid.stateInit.code!, routes: artifact.routes, peers: artifact.peers, initialRam: [1] }), /initial RAM root/);
  assert.throws(() => buildV2StateInit(code, { manifest: { ...artifact.manifest, runId: "bad" }, rom: valid.stateInit.code!, routes: artifact.routes, peers: artifact.peers }), /256-bit/);
});
