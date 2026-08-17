import { createHash } from "node:crypto";
import { ABI_VERSION, ISA_VERSION, PROTOCOL_VERSION, RAM_NIBBLES, ROM_WORDS, SCHEMA_VERSION, WORD_BITS } from "../../isa/src/constants.js";
import { assembleV2, type V2AssemblyResult } from "./assembler.js";
import { deriveRunId, limitsHash, programId, protocolVersions, staticCommitment, type Hash256, type LimitsV2 } from "./commitments.js";
import { normalizeRam, normalizeRom, ramRoot, ramRootCell, romRoot, romRootCell } from "./memory.js";
import { normalizePeers, peerRoot, type PeerDescriptor } from "./peers.js";
import { normalizeRoutes, routeRoot, type RouteDescriptor } from "./routes.js";

export interface CompilerInfo {
  readonly name: string;
  readonly version: string;
  readonly gitCommit: string;
  readonly node: string;
}

export interface ArtifactManifestV2 {
  readonly artifactVersion: 2;
  readonly name: string;
  readonly description: string;
  readonly schemaVersion: 2;
  readonly isaVersion: 2;
  readonly abiVersion: 2;
  readonly protocolVersion: 2;
  readonly wordBits: 16;
  readonly romWords: 1024;
  readonly ramNibbles: 256;
  readonly entryPc: number;
  readonly coreId: number;
  readonly runId: Hash256;
  readonly runSalt: Hash256;
  readonly romRoot: Hash256;
  readonly initialRamRoot: Hash256;
  readonly routeRoot: Hash256;
  readonly peerRoot: Hash256;
  readonly programId: Hash256;
  readonly limitsHash: Hash256;
  readonly staticCommitment: Hash256;
  readonly sourceHash: Hash256;
  readonly compiler: CompilerInfo;
}

export interface BuildArtifactOptions {
  readonly name: string;
  readonly description?: string;
  readonly fileName?: string;
  readonly coreId?: number;
  readonly runId?: Hash256;
  readonly runSalt?: Hash256;
  readonly routes?: readonly RouteDescriptor[];
  readonly peers?: readonly PeerDescriptor[];
  readonly limits?: Partial<LimitsV2>;
  readonly compiler?: Partial<CompilerInfo>;
}

export interface ArtifactBundle {
  readonly manifest: ArtifactManifestV2;
  readonly source: string;
  readonly assembly: V2AssemblyResult;
  readonly routes: readonly RouteDescriptor[];
  readonly peers: readonly PeerDescriptor[];
  readonly limits: LimitsV2;
  readonly files: Readonly<Record<string, string>>;
}

export interface ArtifactVerificationReport {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly computed: Readonly<Record<string, string>>;
}

export const DEFAULT_LIMITS: LimitsV2 = {
  maxStepsPerAdvance: 1,
  maxInputRecords: 16,
  maxOutputRecords: 16,
  maxActionsPerAdvance: 32,
  maxOutputsPerAdvance: 16,
};

export function buildArtifact(source: string, options: BuildArtifactOptions): ArtifactBundle {
  const assembly = assembleV2(source, options.fileName ?? "program.tasm");
  const routes = normalizeRoutes(options.routes ?? []);
  const peers = normalizePeers(options.peers ?? []);
  const limits: LimitsV2 = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };
  validateLimits(limits);
  const romRootValue = romRoot(assembly.words);
  const initialRamRoot = ramRoot(assembly.ram);
  const routeRootValue = routeRoot(routes);
  const peerRootValue = peerRoot(peers);
  const programIdValue = programId({
    artifactVersion: 2,
    isaVersion: ISA_VERSION,
    wordBits: WORD_BITS,
    romWords: ROM_WORDS,
    ramNibbles: RAM_NIBBLES,
    entryPc: assembly.entryPc,
    romRoot: romRootValue,
    initialRamRoot,
  });
  const runSalt = options.runSalt ?? zeroHash();
  const runId = options.runId ?? deriveRunId([programIdValue], routeRootValue, runSalt);
  const limitsHashValue = limitsHash(limits);
  const staticCommitmentValue = staticCommitment({
    schemaVersion: SCHEMA_VERSION,
    isaVersion: ISA_VERSION,
    abiVersion: ABI_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    runId,
    coreId: options.coreId ?? 0,
    programId: programIdValue,
    romRoot: romRootValue,
    routeRoot: routeRootValue,
    peerRoot: peerRootValue,
    limitsHash: limitsHashValue,
  });
  const compiler: CompilerInfo = {
    name: options.compiler?.name ?? "tonolith-assembler",
    version: options.compiler?.version ?? "0.1.0",
    gitCommit: options.compiler?.gitCommit ?? "0".repeat(40),
    node: options.compiler?.node ?? process.version,
  };
  validateCompiler(compiler);
  const manifest: ArtifactManifestV2 = {
    artifactVersion: 2,
    name: options.name,
    description: options.description ?? "",
    schemaVersion: 2,
    isaVersion: 2,
    abiVersion: 2,
    protocolVersion: 2,
    wordBits: 16,
    romWords: 1024,
    ramNibbles: 256,
    entryPc: assembly.entryPc,
    coreId: options.coreId ?? 0,
    runId,
    runSalt,
    romRoot: romRootValue,
    initialRamRoot,
    routeRoot: routeRootValue,
    peerRoot: peerRootValue,
    programId: programIdValue,
    limitsHash: limitsHashValue,
    staticCommitment: staticCommitmentValue,
    sourceHash: sha256(assembly.canonicalSource),
    compiler,
  };
  const files = makeFiles(manifest, source, assembly, routes, peers, limits);
  return { manifest, source, assembly, routes, peers, limits, files };
}

export function verifyArtifact(bundle: ArtifactBundle): ArtifactVerificationReport {
  const errors: string[] = [];
  let computedValues: Record<string, string> = {};
  const manifest = bundle.manifest;
  const versions = protocolVersions();
  if (manifest.artifactVersion !== 2) errors.push("unsupported artifactVersion");
  if (manifest.schemaVersion !== versions.schemaVersion) errors.push("unsupported schemaVersion");
  if (manifest.isaVersion !== versions.isaVersion) errors.push("unsupported isaVersion");
  if (manifest.abiVersion !== versions.abiVersion) errors.push("unsupported abiVersion");
  if (manifest.protocolVersion !== versions.protocolVersion) errors.push("unsupported protocolVersion");
  for (const field of ["runId", "runSalt", "romRoot", "initialRamRoot", "routeRoot", "peerRoot", "programId", "limitsHash", "staticCommitment", "sourceHash"] as const) {
    if (!/^[0-9a-f]{64}$/.test(manifest[field])) errors.push(`${field} is not canonical lowercase uint256 hex`);
  }
  try {
    const computedRomRoot = romRoot(bundle.assembly.words);
    const computedRamRoot = ramRoot(bundle.assembly.ram);
    const computedRouteRoot = routeRoot(bundle.routes);
    const computedPeerRoot = peerRoot(bundle.peers);
    const computedProgramId = programId({
      artifactVersion: 2,
      isaVersion: 2,
      wordBits: WORD_BITS,
      romWords: ROM_WORDS,
      ramNibbles: RAM_NIBBLES,
      entryPc: bundle.assembly.entryPc,
      romRoot: computedRomRoot,
      initialRamRoot: computedRamRoot,
    });
    const computedLimitsHash = limitsHash(bundle.limits);
    const computedStatic = staticCommitment({
      schemaVersion: 2,
      isaVersion: 2,
      abiVersion: 2,
      protocolVersion: 2,
      runId: manifest.runId,
      coreId: manifest.coreId,
      programId: computedProgramId,
      romRoot: computedRomRoot,
      routeRoot: computedRouteRoot,
      peerRoot: computedPeerRoot,
      limitsHash: computedLimitsHash,
    });
    const computedRunId = deriveRunId([computedProgramId], computedRouteRoot, manifest.runSalt);
    const computed = {
      romRoot: computedRomRoot,
      initialRamRoot: computedRamRoot,
      routeRoot: computedRouteRoot,
      peerRoot: computedPeerRoot,
      programId: computedProgramId,
      limitsHash: computedLimitsHash,
      staticCommitment: computedStatic,
      derivedRunId: computedRunId,
      sourceHash: sha256(bundle.assembly.canonicalSource),
    };
    computedValues = computed;
    for (const [field, value] of Object.entries(computed)) {
      const manifestField = field === "derivedRunId" ? "runId" : field;
      if (manifest[manifestField as keyof ArtifactManifestV2] !== value) errors.push(`${manifestField} does not match recomputed commitment`);
    }
    if (manifest.entryPc !== bundle.assembly.entryPc) errors.push("entryPc does not match assembly");
    if (manifest.coreId < 0 || manifest.coreId > 0xffff || !Number.isInteger(manifest.coreId)) errors.push("coreId is out of range");
    validateCompiler(manifest.compiler);
    validateLimits(bundle.limits);
    const artifactJson = bundle.files["artifact.json"];
    if (artifactJson !== undefined && artifactJson !== canonicalJson(manifest)) errors.push("artifact.json is not canonical or does not match manifest");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    valid: errors.length === 0,
    errors,
    computed: computedValues,
  };
}

export function assertArtifact(bundle: ArtifactBundle): void {
  const report = verifyArtifact(bundle);
  if (!report.valid) throw new Error(`invalid v2 artifact: ${report.errors.join("; ")}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function makeFiles(manifest: ArtifactManifestV2, source: string, assembly: V2AssemblyResult, routes: readonly RouteDescriptor[], peers: readonly PeerDescriptor[], limits: LimitsV2): Readonly<Record<string, string>> {
  const artifactJson = canonicalJson(manifest);
  return {
    "artifact.json": artifactJson,
    "program.tasm": source,
    "program.rom.boc": romRootCell(assembly.words).toBoc({ idx: false }).toString("base64"),
    "initial-ram.boc": ramRootCell(assembly.ram).toBoc({ idx: false }).toString("base64"),
    "symbols.json": canonicalJson({ labels: assembly.labels, exports: assembly.exports }),
    "source-map.json": canonicalJson(assembly.sourceMap),
    "assembly.json": canonicalJson({
      words: assembly.words,
      ram: Array.from(assembly.ram),
      entryPc: assembly.entryPc,
      labels: assembly.labels,
      exports: assembly.exports,
      sourceMap: assembly.sourceMap,
      canonicalSource: assembly.canonicalSource,
    }),
    "limits.json": canonicalJson(limits),
    "routes.json": canonicalJson(routes),
    "peers.json": canonicalJson(peers),
    "BUILDINFO.json": canonicalJson({ artifactSha256: sha256(artifactJson), compiler: manifest.compiler, sourceHash: manifest.sourceHash }),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function zeroHash(): Hash256 {
  return "0".repeat(64);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortJson(entry)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("canonical JSON cannot contain non-finite numbers");
  return value;
}

function validateCompiler(compiler: CompilerInfo): void {
  if (compiler.name.length === 0 || compiler.version.length === 0 || compiler.node.length === 0 || !/^[0-9a-f]{40}$/.test(compiler.gitCommit)) {
    throw new RangeError("compiler metadata is not canonical");
  }
}

function validateLimits(limits: LimitsV2): void {
  if (!Number.isInteger(limits.maxStepsPerAdvance) || limits.maxStepsPerAdvance < 1 || limits.maxStepsPerAdvance > 0xffff) throw new RangeError("maxStepsPerAdvance is out of range");
  if (!Number.isInteger(limits.maxInputRecords) || limits.maxInputRecords < 1 || limits.maxInputRecords > 16) throw new RangeError("maxInputRecords is out of range");
  if (!Number.isInteger(limits.maxOutputRecords) || limits.maxOutputRecords < 1 || limits.maxOutputRecords > 16) throw new RangeError("maxOutputRecords is out of range");
  if (!Number.isInteger(limits.maxActionsPerAdvance) || limits.maxActionsPerAdvance < 1 || limits.maxActionsPerAdvance > 32) throw new RangeError("maxActionsPerAdvance is out of range");
  if (!Number.isInteger(limits.maxOutputsPerAdvance) || limits.maxOutputsPerAdvance < 1 || limits.maxOutputsPerAdvance > 16) throw new RangeError("maxOutputsPerAdvance is out of range");
}
