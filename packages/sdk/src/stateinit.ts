import {
  Address,
  beginCell,
  contractAddress,
  storeStateInit,
  type Cell,
  type StateInit,
} from "@ton/core";
import { staticCommitmentCell } from "../../artifact/src/commitments.js";
import { peerRoot, peerRootCell, type PeerDescriptor } from "../../artifact/src/peers.js";
import { routeRootCell, type RouteDescriptor } from "../../artifact/src/routes.js";
import { normalizeRam, ramRoot, romRootCell } from "../../artifact/src/memory.js";
import { createInitialState, type CoreConfig } from "../../emulator/src/model.js";
import { coreStateCell, stateHash } from "../../emulator/src/commitments.js";
import type { ArtifactBundle, ArtifactManifestV2 } from "../../artifact/src/manifest.js";

export interface V2StateInitDescriptor {
  readonly manifest: Pick<ArtifactManifestV2,
    | "schemaVersion"
    | "isaVersion"
    | "abiVersion"
    | "protocolVersion"
    | "coreId"
    | "runId"
    | "programId"
    | "romRoot"
    | "initialRamRoot"
    | "routeRoot"
    | "peerRoot"
    | "limitsHash"
    | "staticCommitment"
  >;
  readonly rom: Cell;
  readonly routes: readonly RouteDescriptor[];
  readonly peers: readonly PeerDescriptor[];
  readonly initialRam?: readonly number[] | Uint8Array;
  readonly workchain?: number;
}

export interface V2StateInitResult {
  readonly data: Cell;
  readonly stateInit: StateInit;
  readonly stateInitCell: Cell;
  readonly stateInitHash: string;
  readonly address: Address;
  readonly codeHash: string;
  readonly dataHash: string;
  readonly staticCommitment: string;
  readonly initialStateHash: string;
  readonly initialState: ReturnType<typeof createInitialState>;
}

export function buildV2StateInit(code: Cell, descriptor: V2StateInitDescriptor): V2StateInitResult {
  const normalizedPeers = descriptor.peers.map((peer) => ({ ...peer }));
  const normalizedRoutes = descriptor.routes.map((route) => ({ ...route }));
  const computedPeerRoot = peerRoot(normalizedPeers);
  if (computedPeerRoot !== descriptor.manifest.peerRoot) throw new Error("peer root does not match the deployment manifest");
  const computedRouteRoot = routeRootCell(normalizedRoutes).hash().toString("hex");
  if (computedRouteRoot !== descriptor.manifest.routeRoot) throw new Error("route root does not match the deployment manifest");

  const staticCell = staticCommitmentCell({
    schemaVersion: descriptor.manifest.schemaVersion,
    isaVersion: descriptor.manifest.isaVersion,
    abiVersion: descriptor.manifest.abiVersion,
    protocolVersion: descriptor.manifest.protocolVersion,
    runId: descriptor.manifest.runId,
    coreId: descriptor.manifest.coreId,
    programId: descriptor.manifest.programId,
    romRoot: descriptor.manifest.romRoot,
    routeRoot: descriptor.manifest.routeRoot,
    peerRoot: descriptor.manifest.peerRoot,
    limitsHash: descriptor.manifest.limitsHash,
  });
  const computedStatic = staticCell.hash().toString("hex");
  if (computedStatic !== descriptor.manifest.staticCommitment) throw new Error("static commitment does not match the deployment manifest");

  const config: CoreConfig = {
    runId: descriptor.manifest.runId,
    coreId: descriptor.manifest.coreId,
    programId: descriptor.manifest.programId,
    romRoot: descriptor.manifest.romRoot,
    initialRamRoot: descriptor.manifest.initialRamRoot,
    routeRoot: descriptor.manifest.routeRoot,
    staticCommitment: descriptor.manifest.staticCommitment,
    routes: normalizedRoutes,
    requiredInputs: [],
    maxStepsPerAdvance: 1,
  };
  const initialState = createInitialState(config);
  initialState.ram = normalizeRam(descriptor.initialRam ?? []);
  if (ramRoot(initialState.ram) !== descriptor.manifest.initialRamRoot) throw new Error("initial RAM root does not match the deployment manifest");
  const coreCell = coreStateCell(initialState);
  const routesCell = routeRootCell(normalizedRoutes);
  const peersCell = peerRootCell(normalizedPeers);
  const identityCell = beginCell()
    .storeUint(descriptor.manifest.coreId, 16)
    .storeUint(toBigInt(descriptor.manifest.runId), 256)
    .storeUint(toBigInt(descriptor.manifest.staticCommitment), 256)
    .storeUint(toBigInt(descriptor.manifest.programId), 256)
    .storeRef(
      beginCell()
        .storeUint(toBigInt(descriptor.manifest.romRoot), 256)
        .storeUint(toBigInt(descriptor.manifest.routeRoot), 256)
        .storeUint(toBigInt(descriptor.manifest.limitsHash), 256)
        .storeRef(beginCell().storeUint(toBigInt(descriptor.manifest.peerRoot), 256).endCell())
        .endCell(),
    )
    .endCell();
  const networkCell = beginCell().storeRef(routesCell).storeRef(peersCell).endCell();
  const data = beginCell()
    .storeUint(0x544e4c32, 32)
    .storeUint(descriptor.manifest.schemaVersion, 16)
    .storeUint(descriptor.manifest.isaVersion, 16)
    .storeUint(descriptor.manifest.abiVersion, 16)
    .storeUint(descriptor.manifest.protocolVersion, 16)
    .storeRef(identityCell)
    .storeRef(coreCell)
    .storeRef(descriptor.rom)
    .storeRef(networkCell)
    .endCell();
  const stateInit: StateInit = { code, data };
  const stateInitCell = beginCell().store(storeStateInit(stateInit)).endCell();
  const workchain = descriptor.workchain ?? 0;
  return {
    data,
    stateInit,
    stateInitCell,
    stateInitHash: stateInitCell.hash().toString("hex"),
    address: contractAddress(workchain, stateInit),
    codeHash: code.hash().toString("hex"),
    dataHash: data.hash().toString("hex"),
    staticCommitment: computedStatic,
    initialStateHash: stateHash(initialState),
    initialState,
  };
}

export function buildV2StateInitFromArtifact(code: Cell, artifact: ArtifactBundle, workchain = 0): V2StateInitResult {
  const romCell = romRootCell(artifact.assembly.words);
  return buildV2StateInit(code, {
    manifest: artifact.manifest,
    rom: romCell,
    routes: artifact.routes,
    peers: artifact.peers,
    initialRam: artifact.assembly.ram,
    workchain,
  });
}

function toBigInt(hash: string): bigint {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new RangeError("expected a 256-bit hexadecimal commitment");
  return BigInt(`0x${hash}`);
}
