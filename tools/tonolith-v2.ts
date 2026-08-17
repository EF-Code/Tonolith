import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Cell } from "@ton/core";
import { buildArtifact, canonicalJson, verifyArtifact, type ArtifactBundle } from "../packages/artifact/src/manifest.js";
import { encodeAdvanceV2 } from "../packages/abi/src/messages.js";
import { advance } from "../packages/emulator/src/executor.js";
import { stateHash } from "../packages/emulator/src/commitments.js";
import type { InputRecord, OutputRecord, V2State } from "../packages/emulator/src/model.js";
import { loadArtifactDirectory } from "../packages/sdk/src/node.js";
import { buildV2StateInitFromArtifact } from "../packages/sdk/src/stateinit.js";
import { planNextAction } from "../packages/keeper/src/planner.js";
import type { KeeperCoreConfig, KeeperCoreObservation } from "../packages/keeper/src/types.js";
import { decodeTrace } from "../packages/trace/src/index.js";
import { verifyRunFromSources, type RawChainSnapshot, type ReplayEvidence, type V2VerificationExpectations } from "../packages/verifier/src/index.js";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: CliIo = { stdout: (value) => console.log(value), stderr: (value) => console.error(value) };

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined) return usage(io, 2);
    switch (command) {
      case "assemble": return await assembleCommand(rest, io);
      case "inspect": return await inspectCommand(rest, io);
      case "verify-artifact": return await verifyArtifactCommand(rest, io);
      case "derive-address": return await deriveAddressCommand(rest, io);
      case "deploy-plan": return await deployPlanCommand(rest, io);
      case "verify-run": return await verifyRunCommand(rest, io);
      case "replay": return await replayCommand(rest, io);
      case "trace": return await traceCommand(rest, io);
      case "keeper": return await keeperCommand(rest, io);
      case "benchmark": return await benchmarkCommand(rest, io);
      default: return usage(io, 2, `unknown command ${command}`);
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function assembleCommand(args: readonly string[], io: CliIo): Promise<number> {
  const sourcePath = args[0];
  const out = option(args, "--out");
  if (sourcePath === undefined || out === undefined) return usage(io, 2, "assemble requires <entry.tasm> --out <artifact-dir>");
  const source = await readFile(resolve(sourcePath), "utf8");
  const artifact = buildArtifact(source, {
    name: basename(sourcePath, extname(sourcePath)),
    fileName: basename(sourcePath),
    compiler: { name: "tonolith-assembler", version: "2.0.0", gitCommit: "0".repeat(40), node: process.version },
  });
  await writeArtifactDirectory(resolve(out), artifact);
  io.stdout(json({ command: "assemble", artifactDir: resolve(out), manifest: artifact.manifest }));
  return 0;
}

async function inspectCommand(args: readonly string[], io: CliIo): Promise<number> {
  const target = args[0];
  if (target === undefined) return usage(io, 2, "inspect requires <artifact-or-boc>");
  const targetPath = resolve(target);
  const targetStat = await stat(targetPath);
  if (targetStat.isDirectory()) {
    const artifact = await loadArtifactDirectory(targetPath);
    io.stdout(json({ command: "inspect", kind: "artifact", manifest: artifact.manifest, files: Object.keys(artifact.files).sort() }));
    return 0;
  }
  const cell = firstCell(await readFile(targetPath));
  io.stdout(json({ command: "inspect", kind: "boc", hash: cell.hash().toString("hex"), refs: cell.refs.length, bits: cell.bits.length }));
  return 0;
}

async function verifyArtifactCommand(args: readonly string[], io: CliIo): Promise<number> {
  const directory = args[0];
  if (directory === undefined) return usage(io, 2, "verify-artifact requires <artifact-dir>");
  try {
    const artifact = await loadArtifactDirectory(directory);
    const report = verifyArtifact(artifact);
    io.stdout(json({ command: "verify-artifact", ...report }));
    return report.valid ? 0 : 1;
  } catch (error) {
    io.stdout(json({ command: "verify-artifact", valid: false, errors: [error instanceof Error ? error.message : String(error)] }));
    return 1;
  }
}

async function deriveAddressCommand(args: readonly string[], io: CliIo): Promise<number> {
  const directory = args[0];
  const network = option(args, "--network");
  const codePath = option(args, "--code-boc");
  if (directory === undefined || network === undefined || codePath === undefined) return usage(io, 2, "derive-address requires <artifact-dir> --network testnet --code-boc <file>");
  assertTestnet(network);
  const artifact = await loadArtifactDirectory(directory);
  const code = firstCell(await readFile(resolve(codePath)));
  const result = buildV2StateInitFromArtifact(code, artifact);
  io.stdout(json({ command: "derive-address", network, address: result.address.toString(), codeHash: result.codeHash, dataHash: result.dataHash, stateInitHash: result.stateInitHash, staticCommitment: result.staticCommitment, initialStateHash: result.initialStateHash }));
  return 0;
}

async function deployPlanCommand(args: readonly string[], io: CliIo): Promise<number> {
  const runPath = args[0];
  const network = option(args, "--network");
  if (runPath === undefined || network === undefined) return usage(io, 2, "deploy-plan requires <run.json> --network testnet");
  assertTestnet(network);
  const run = await readJson<DeployRunConfig>(runPath);
  const artifact = await loadArtifactDirectory(run.artifactDir);
  const code = firstCell(await readFile(resolve(run.codeBoc)));
  const stateInit = buildV2StateInitFromArtifact(code, artifact, run.workchain ?? 0);
  io.stdout(json({
    command: "deploy-plan",
    network,
    address: stateInit.address.toString(),
    codeHash: stateInit.codeHash,
    dataHash: stateInit.dataHash,
    stateInitHash: stateInit.stateInitHash,
    initialStateHash: stateInit.initialStateHash,
    requiredBalanceNano: run.requiredBalanceNano ?? "500000000",
    actions: ["fund deployment wallet", "submit StateInit", "wait for inclusion", "wait for masterchain-referenced finality", "verify account commitments"],
    broadcast: false,
  }));
  return 0;
}

async function verifyRunCommand(args: readonly string[], io: CliIo): Promise<number> {
  const manifestPath = args[0];
  const network = option(args, "--network");
  if (manifestPath === undefined || network === undefined) return usage(io, 2, "verify-run requires <run-manifest.json> --network testnet");
  assertTestnet(network);
  const manifest = await readJson<RunManifest>(manifestPath);
  const sources = manifest.sources.map((source) => ({ id: source.id, fetchSnapshot: async () => readJson<RawChainSnapshot>(source.snapshot) }));
  const replay = manifest.replay === undefined ? undefined : deserializeReplay(manifest.replay);
  const report = await verifyRunFromSources(manifest.address, manifest.expectations, sources, replay);
  io.stdout(json(report));
  return report.overall === "verified" ? 0 : 1;
}

async function replayCommand(args: readonly string[], io: CliIo): Promise<number> {
  const manifestPath = args[0];
  const network = option(args, "--network");
  if (manifestPath === undefined || network === undefined) return usage(io, 2, "replay requires <run-manifest.json> --network testnet");
  assertTestnet(network);
  const manifest = await readJson<RunManifest>(manifestPath);
  if (manifest.replay === undefined) return incompleteNetworkCommand("replay", io, "run manifest does not contain independent replay evidence");
  const sources = manifest.sources.map((source) => ({ id: source.id, fetchSnapshot: async () => readJson<RawChainSnapshot>(source.snapshot) }));
  const report = await verifyRunFromSources(manifest.address, manifest.expectations, sources, deserializeReplay(manifest.replay));
  io.stdout(json({ command: "replay", ...report }));
  return report.overall === "verified" ? 0 : 1;
}

async function traceCommand(args: readonly string[], io: CliIo): Promise<number> {
  const address = args[0];
  const format = option(args, "--format");
  const input = option(args, "--input");
  if (address === undefined || format === undefined || !["text", "json", "ndjson"].includes(format)) return usage(io, 2, "trace requires <address> --format text|json|ndjson --input <trace.json>");
  if (input === undefined) return incompleteNetworkCommand("trace", io, `no raw trace supplied for ${address}`);
  const trace = decodeTrace(await readFile(resolve(input), "utf8"));
  if (format === "text") io.stdout(formatTraceText(trace));
  else if (format === "json") io.stdout(json(trace));
  else io.stdout(formatNdjson(trace));
  return 0;
}

async function keeperCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args[0] !== "run" || args[1] === undefined) return usage(io, 2, "keeper run requires <config>");
  const encoded = await readJson<KeeperConfigFileJson>(args[1]);
  const config: KeeperConfigFile = {
    core: {
      ...encoded.core,
      advanceValueNano: BigInt(encoded.core.advanceValueNano),
      dispatchValueNano: BigInt(encoded.core.dispatchValueNano),
    },
    observation: {
      ...encoded.observation,
      advanceCount: BigInt(encoded.observation.advanceCount),
      inputCount: BigInt(encoded.observation.inputCount),
    },
    ...(encoded.queryId === undefined ? {} : { queryId: encoded.queryId }),
  };
  assertTestnet(config.core.network);
  const action = planNextAction(config.core, config.observation, BigInt(config.queryId ?? "0"));
  io.stdout(json({ command: "keeper run", mode: "read-only", action, unresolved: ["wallet and provider adapters are external to this CLI invocation"] }));
  return 0;
}

async function benchmarkCommand(args: readonly string[], io: CliIo): Promise<number> {
  const mode = args[0];
  const artifactPath = args[1];
  if (mode !== "local" && mode !== "testnet") return usage(io, 2, "benchmark requires local|testnet <artifact-or-deployment>");
  if (artifactPath === undefined) return usage(io, 2, "benchmark requires an artifact or deployment record");
  if (mode === "testnet") return incompleteNetworkCommand("benchmark testnet", io, "testnet deployment record and raw providers are required");
  const artifact = await loadArtifactDirectory(artifactPath);
  const state = artifactToInitialState(artifact);
  const result = advance(state, { rom: artifact.assembly.words }, {
    expectedAdvanceCount: 0n,
    expectedStateHash: stateHash(state),
    maxInstructions: artifact.limits.maxStepsPerAdvance,
    maxOutputs: artifact.limits.maxOutputsPerAdvance,
  });
  io.stdout(json({ command: "benchmark local", artifact: artifact.manifest.name, executed: result.executed, requestedMaxInstructions: artifact.limits.maxStepsPerAdvance, requestedMaxOutputs: artifact.limits.maxOutputsPerAdvance, stopReason: result.stopReason, stateHash: stateHash(result.state) }));
  return 0;
}

function artifactToInitialState(artifact: ArtifactBundle) {
  const { createInitialState } = requireEmulatorModel();
  const state = createInitialState({
    runId: artifact.manifest.runId,
    coreId: artifact.manifest.coreId,
    programId: artifact.manifest.programId,
    romRoot: artifact.manifest.romRoot,
    initialRamRoot: artifact.manifest.initialRamRoot,
    routeRoot: artifact.manifest.routeRoot,
    staticCommitment: artifact.manifest.staticCommitment,
    routes: artifact.routes,
    requiredInputs: [],
    maxStepsPerAdvance: artifact.limits.maxStepsPerAdvance,
  });
  state.ram = artifact.assembly.ram.slice();
  return state;
}

function requireEmulatorModel(): typeof import("../packages/emulator/src/model.js") {
  // Kept as a function so the browser-safe SDK never inherits this CLI's Node path.
  return requireModel;
}

import * as requireModel from "../packages/emulator/src/model.js";

function deserializeReplay(value: RunManifest["replay"]): ReplayEvidence | undefined {
  if (value === undefined) return undefined;
  const initial = value.initialState;
  return {
    rom: value.rom,
    initialState: {
      ...initial,
      advanceCount: BigInt(initial.advanceCount),
      acceptedMessageCount: BigInt(initial.acceptedMessageCount),
      instructionCount: BigInt(initial.instructionCount),
      outputCount: BigInt(initial.outputCount),
      inputCount: BigInt(initial.inputCount),
      epoch: BigInt(initial.epoch),
      ram: Uint8Array.from(initial.ram),
      registers: [...initial.registers],
      nextOutputSequence: [...initial.nextOutputSequence],
      inbox: initial.inbox.map((record) => ({ ...record, sourceEpoch: BigInt(record.sourceEpoch), destinationEpoch: BigInt(record.destinationEpoch), sourceInstructionCount: BigInt(record.sourceInstructionCount) })),
      outbox: initial.outbox.map((record) => ({ ...record, sourceEpoch: BigInt(record.sourceEpoch), destinationEpoch: BigInt(record.destinationEpoch), sourceInstructionCount: BigInt(record.sourceInstructionCount) })),
    },
  };
}

interface DeployRunConfig { readonly artifactDir: string; readonly codeBoc: string; readonly workchain?: number; readonly requiredBalanceNano?: string; }
interface RunManifest { readonly address: string; readonly expectations: V2VerificationExpectations; readonly sources: readonly { readonly id: string; readonly snapshot: string }[]; readonly replay?: { readonly rom: readonly number[]; readonly initialState: ReplayStateJson }; }
interface KeeperConfigFile { readonly core: KeeperCoreConfig; readonly observation: KeeperCoreObservation; readonly queryId?: string; }
interface KeeperConfigFileJson {
  readonly core: Omit<KeeperCoreConfig, "advanceValueNano" | "dispatchValueNano"> & { readonly advanceValueNano: string | number; readonly dispatchValueNano: string | number };
  readonly observation: Omit<KeeperCoreObservation, "advanceCount" | "inputCount"> & { readonly advanceCount: string | number; readonly inputCount: string | number };
  readonly queryId?: string;
}

interface ReplayRecordJson extends Omit<InputRecord, "sourceEpoch" | "destinationEpoch" | "sourceInstructionCount"> {
  readonly sourceEpoch: string;
  readonly destinationEpoch: string;
  readonly sourceInstructionCount: string;
}

interface ReplayStateJson extends Omit<V2State, "advanceCount" | "acceptedMessageCount" | "instructionCount" | "outputCount" | "inputCount" | "epoch" | "ram" | "inbox" | "outbox"> {
  readonly advanceCount: string;
  readonly acceptedMessageCount: string;
  readonly instructionCount: string;
  readonly outputCount: string;
  readonly inputCount: string;
  readonly epoch: string;
  readonly ram: readonly number[];
  readonly inbox: readonly ReplayRecordJson[];
  readonly outbox: readonly ReplayRecordJson[];
}

function firstCell(value: Buffer): Cell {
  const cell = Cell.fromBoc(value)[0];
  if (cell === undefined) throw new Error("BOC did not contain a root cell");
  return cell;
}

async function writeArtifactDirectory(directory: string, artifact: ArtifactBundle): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(artifact.files)) await writeFile(join(directory, name), content, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function assertTestnet(network: string): void {
  if (network !== "testnet") throw new Error("Tonolith v2 CLI is restricted to TON testnet during this release");
}

function incompleteNetworkCommand(command: string, io: CliIo, reason = "a configured raw-chain provider is required"): number {
  io.stdout(json({ command, overall: "incomplete", network: "testnet", unresolved: [reason], broadcast: false }));
  return 1;
}

function formatTraceText(value: unknown): string {
  if (!Array.isArray(value)) return JSON.stringify(value, null, 2);
  return value.map((entry, index) => `${String(index).padStart(4, "0")} ${JSON.stringify(entry)}`).join("\n");
}

function formatNdjson(value: unknown): string {
  return Array.isArray(value) ? value.map((entry) => JSON.stringify(entry)).join("\n") : JSON.stringify(value);
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry, 2);
}

function usage(io: CliIo, code: number, message?: string): number {
  if (message !== undefined) io.stderr(message);
  io.stderr("usage: tonolith <assemble|inspect|verify-artifact|derive-address|deploy-plan|replay|verify-run|trace|keeper|benchmark> ...");
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await runCli(process.argv.slice(2));
