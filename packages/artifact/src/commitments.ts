import { beginCell, type Cell } from "@ton/core";
import { ABI_VERSION, DOMAIN, ISA_VERSION, PROTOCOL_VERSION, SCHEMA_VERSION } from "../../isa/src/constants.js";

export type Hash256 = string;

export interface ProgramFields {
  readonly artifactVersion: number;
  readonly isaVersion: number;
  readonly wordBits: number;
  readonly romWords: number;
  readonly ramNibbles: number;
  readonly entryPc: number;
  readonly romRoot: Hash256;
  readonly initialRamRoot: Hash256;
}

export interface LimitsV2 {
  readonly maxStepsPerAdvance: number;
  readonly maxInputRecords: number;
  readonly maxOutputRecords: number;
  readonly maxActionsPerAdvance: number;
  readonly maxOutputsPerAdvance: number;
}

export function programCommitmentCell(fields: ProgramFields): Cell {
  return beginCell()
    .storeUint(DOMAIN.program, 32)
    .storeUint(fields.artifactVersion, 16)
    .storeUint(fields.isaVersion, 16)
    .storeUint(fields.wordBits, 8)
    .storeUint(fields.romWords, 16)
    .storeUint(fields.ramNibbles, 16)
    .storeUint(fields.entryPc, 16)
    .storeUint(toBigInt(fields.romRoot), 256)
    .storeUint(toBigInt(fields.initialRamRoot), 256)
    .endCell();
}

export function programId(fields: ProgramFields): Hash256 {
  return programCommitmentCell(fields).hash().toString("hex");
}

export function limitsCell(limits: LimitsV2): Cell {
  return beginCell()
    .storeUint(DOMAIN.limits, 32)
    .storeUint(limits.maxStepsPerAdvance, 16)
    .storeUint(limits.maxInputRecords, 8)
    .storeUint(limits.maxOutputRecords, 8)
    .storeUint(limits.maxActionsPerAdvance, 8)
    .storeUint(limits.maxOutputsPerAdvance, 8)
    .endCell();
}

export function limitsHash(limits: LimitsV2): Hash256 {
  return limitsCell(limits).hash().toString("hex");
}

export function staticCommitmentCell(fields: {
  readonly schemaVersion: number;
  readonly isaVersion: number;
  readonly abiVersion: number;
  readonly protocolVersion: number;
  readonly runId: Hash256;
  readonly coreId: number;
  readonly programId: Hash256;
  readonly romRoot: Hash256;
  readonly routeRoot: Hash256;
  readonly limitsHash: Hash256;
}): Cell {
  const programPayload = beginCell()
    .storeUint(toBigInt(fields.programId), 256)
    .storeUint(toBigInt(fields.romRoot), 256)
    .storeUint(toBigInt(fields.routeRoot), 256)
    .endCell();
  const limitsPayload = beginCell().storeUint(toBigInt(fields.limitsHash), 256).endCell();
  return beginCell()
    .storeUint(DOMAIN.static, 32)
    .storeUint(fields.schemaVersion, 16)
    .storeUint(fields.isaVersion, 16)
    .storeUint(fields.abiVersion, 16)
    .storeUint(fields.protocolVersion, 16)
    .storeUint(toBigInt(fields.runId), 256)
    .storeUint(fields.coreId, 16)
    .storeRef(programPayload)
    .storeRef(limitsPayload)
    .endCell();
}

export function staticCommitment(fields: Parameters<typeof staticCommitmentCell>[0]): Hash256 {
  return staticCommitmentCell(fields).hash().toString("hex");
}

export function deriveRunId(programIds: readonly Hash256[], routeRoot: Hash256, salt: Hash256): Hash256 {
  if (programIds.length < 1 || programIds.length > 0xff) throw new RangeError("run must contain 1..255 program IDs");
  const builder = beginCell()
    .storeUint(DOMAIN.run, 32)
    .storeUint(PROTOCOL_VERSION, 16)
    .storeUint(programIds.length, 8)
    .storeUint(toBigInt(routeRoot), 256)
    .storeUint(toBigInt(salt), 256);
  programIds.forEach((id, index) => builder.storeUint(index, 16).storeUint(toBigInt(id), 256));
  return builder.endCell().hash().toString("hex");
}

export function protocolVersions(): { schemaVersion: number; isaVersion: number; abiVersion: number; protocolVersion: number } {
  return { schemaVersion: SCHEMA_VERSION, isaVersion: ISA_VERSION, abiVersion: ABI_VERSION, protocolVersion: PROTOCOL_VERSION };
}

function toBigInt(value: Hash256): bigint {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new RangeError("commitment must be a 256-bit hexadecimal value");
  return BigInt(`0x${value}`);
}
