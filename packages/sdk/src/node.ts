import { readFile, readdir } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertArtifact, type ArtifactBundle, type ArtifactManifestV2, type CompilerInfo } from "../../artifact/src/manifest.js";
import type { V2AssemblyResult, V2SourceMapEntry } from "../../artifact/src/assembler.js";
import type { LimitsV2 } from "../../artifact/src/commitments.js";
import { normalizePeers, type PeerDescriptor } from "../../artifact/src/peers.js";
import { normalizeRoutes, type RouteDescriptor } from "../../artifact/src/routes.js";

const REQUIRED_FILES = [
  "artifact.json",
  "program.tasm",
  "assembly.json",
  "limits.json",
  "routes.json",
  "peers.json",
] as const;

/** Load a canonical v2 artifact without relying on the checkout that built it. */
export async function loadArtifactDirectory(directory: string): Promise<ArtifactBundle> {
  const root = resolve(directory);
  const names = new Set(await readdir(root));
  const files: Record<string, string> = {};
  await Promise.all(REQUIRED_FILES.map(async (name) => {
    if (!names.has(name)) throw new Error(`artifact is missing ${name}`);
    files[name] = await readFile(join(root, name), "utf8");
  }));
  for (const name of names) {
    if (name === "artifact.json" || name === "program.tasm" || name === "assembly.json" || name === "limits.json" || name === "routes.json" || name === "peers.json") continue;
    const path = join(root, name);
    const content = await readFile(path, "utf8").catch(() => undefined);
    if (content !== undefined) files[name] = content;
  }
  return finishBundle(files);
}

/** Synchronous counterpart for CLIs and deterministic build scripts. */
export function loadArtifactDirectorySync(directory: string): ArtifactBundle {
  const root = resolve(directory);
  const names = new Set(readdirSync(root));
  const files: Record<string, string> = {};
  for (const name of REQUIRED_FILES) {
    if (!names.has(name)) throw new Error(`artifact is missing ${name}`);
    files[name] = readFileSync(join(root, name), "utf8");
  }
  for (const name of names) {
    if (REQUIRED_FILES.includes(name as typeof REQUIRED_FILES[number])) continue;
    try {
      files[name] = readFileSync(join(root, name), "utf8");
    } catch {
      // Ignore directories and binary sidecars; canonical required files are text.
    }
  }
  return finishBundle(files);
}

function finishBundle(files: Record<string, string>): ArtifactBundle {
  const manifest = parseJson<ArtifactManifestV2>(files["artifact.json"], "artifact.json");
  const assemblyJson = parseJson<SerializedAssembly>(files["assembly.json"], "assembly.json");
  const limits = parseJson<LimitsV2>(files["limits.json"], "limits.json");
  const routes = normalizeRoutes(parseJson<RouteDescriptor[]>(files["routes.json"], "routes.json"));
  const peers = normalizePeers(parseJson<PeerDescriptor[]>(files["peers.json"], "peers.json"));
  const assembly: V2AssemblyResult = {
    words: [...assemblyJson.words],
    ram: Uint8Array.from(assemblyJson.ram),
    entryPc: assemblyJson.entryPc,
    labels: { ...assemblyJson.labels },
    exports: { ...assemblyJson.exports },
    sourceMap: assemblyJson.sourceMap.map((entry) => ({ ...entry })),
    canonicalSource: assemblyJson.canonicalSource,
  };
  const bundle: ArtifactBundle = {
    manifest,
    source: requiredFile(files, "program.tasm"),
    assembly,
    routes,
    peers,
    limits,
    files,
  };
  assertArtifact(bundle);
  return bundle;
}

function requiredFile(files: Readonly<Record<string, string>>, name: string): string {
  const value = files[name];
  if (value === undefined) throw new Error(`artifact is missing ${name}`);
  return value;
}

interface SerializedAssembly {
  readonly words: readonly number[];
  readonly ram: readonly number[];
  readonly entryPc: number;
  readonly labels: Readonly<Record<string, number>>;
  readonly exports: Readonly<Record<string, number>>;
  readonly sourceMap: readonly V2SourceMapEntry[];
  readonly canonicalSource: string;
}

function parseJson<T>(value: string | undefined, file: string): T {
  if (value === undefined) throw new Error(`artifact is missing ${file}`);
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`invalid ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
