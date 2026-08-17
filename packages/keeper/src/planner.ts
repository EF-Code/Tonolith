import { Address } from "@ton/core";
import { encodeAdvanceV2, encodeDispatchOutputV2 } from "../../abi/src/messages.js";
import { STATUS } from "../../isa/src/constants.js";
import type { KeeperAction, KeeperCoreConfig, KeeperCoreObservation } from "./types.js";

export class KeeperSafetyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "KeeperSafetyError";
  }
}

export function planNextAction(config: KeeperCoreConfig, observation: KeeperCoreObservation, queryId = 0n): KeeperAction | undefined {
  assertObservation(config, observation);
  if (queryId < 0n) throw new KeeperSafetyError("query id must be non-negative");
  if (observation.pendingOutputs.length > 0) {
    const output = observation.pendingOutputs[0];
    if (output === undefined) return undefined;
    return {
      kind: "dispatchOutput",
      address: observation.address,
      runId: observation.runId,
      expectedStateHash: observation.stateHash,
      outputId: output.outputId,
      bodyBoc: encodeDispatchOutputV2({
        queryId,
        runId: observation.runId,
        expectedStateHash: observation.stateHash,
        outputId: output.outputId,
      }).toBoc({ idx: false }).toString("base64"),
      valueNano: config.dispatchValueNano,
      reason: "delivery-priority",
    };
  }
  if (observation.status !== STATUS.running) return undefined;
  return {
    kind: "advance",
    address: observation.address,
    runId: observation.runId,
    expectedStateHash: observation.stateHash,
    expectedAdvanceCount: observation.advanceCount,
    bodyBoc: encodeAdvanceV2({
      queryId,
      runId: observation.runId,
      expectedAdvanceCount: observation.advanceCount,
      expectedStateHash: observation.stateHash,
      maxInstructions: config.maxInstructions,
      maxOutputs: config.maxOutputs,
    }).toBoc({ idx: false }).toString("base64"),
    valueNano: config.advanceValueNano,
    reason: "advance-runnable",
  };
}

function assertObservation(config: KeeperCoreConfig, observation: KeeperCoreObservation): void {
  try {
    if (Address.parse(config.address).toRawString() !== Address.parse(observation.address).toRawString()) throw new KeeperSafetyError("core address mismatch");
  } catch (error) {
    if (error instanceof KeeperSafetyError) throw error;
    throw new KeeperSafetyError(`invalid core address: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (observation.network !== "testnet" || config.network !== "testnet") throw new KeeperSafetyError("keeper is restricted to TON testnet");
  if (observation.codeHash.toLowerCase() !== config.codeHash.toLowerCase()) throw new KeeperSafetyError("core code hash mismatch");
  if (observation.runId.toLowerCase() !== config.runId.toLowerCase()) throw new KeeperSafetyError("core run ID mismatch");
  assertHash(config.runId, "run ID");
  assertHash(config.codeHash, "code hash");
  assertHash(observation.runId, "observed run ID");
  assertHash(observation.codeHash, "observed code hash");
  assertHash(observation.stateHash, "observed state hash");
  if (!Number.isInteger(config.artifactMaxInstructions) || config.artifactMaxInstructions < 1 || config.artifactMaxInstructions > 0xffff) {
    throw new KeeperSafetyError("invalid artifact instruction cap");
  }
  if (!Number.isInteger(config.artifactMaxOutputs) || config.artifactMaxOutputs < 1 || config.artifactMaxOutputs > 0xff) {
    throw new KeeperSafetyError("invalid artifact output cap");
  }
  if (!Number.isInteger(config.maxInstructions) || config.maxInstructions < 1 || config.maxInstructions > 0xffff) throw new KeeperSafetyError("invalid instruction cap");
  if (!Number.isInteger(config.maxOutputs) || config.maxOutputs < 1 || config.maxOutputs > 0xff) throw new KeeperSafetyError("invalid output cap");
  if (config.maxInstructions > config.artifactMaxInstructions) throw new KeeperSafetyError("requested instruction cap exceeds artifact limit");
  if (config.maxOutputs > config.artifactMaxOutputs) throw new KeeperSafetyError("requested output cap exceeds artifact limit");
  if (config.advanceValueNano <= 0n || config.dispatchValueNano <= 0n) throw new KeeperSafetyError("keeper message values must be positive");
  if (observation.advanceCount < 0n) throw new KeeperSafetyError("invalid observed advance count");
  const outputIds = new Set<string>();
  for (const output of observation.pendingOutputs) {
    if (output === undefined) throw new KeeperSafetyError("pending output observation is missing");
    assertHash(output.outputId, "pending output ID");
    const normalized = output.outputId.toLowerCase();
    if (outputIds.has(normalized)) throw new KeeperSafetyError("duplicate pending output ID");
    outputIds.add(normalized);
  }
}

function assertHash(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new KeeperSafetyError(`${field} must be a 256-bit hexadecimal value`);
}
