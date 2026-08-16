import { Address, Cell, contractAddress, loadStateInit } from "@ton/core";
import { decodeV2Message, type V2Message } from "../../abi/src/messages.js";
import {
  acknowledgeOutput,
  advance,
  deliverInput,
  dispatchOutput,
  type DeliverInputMessage,
  type V2AdvanceRequest,
} from "../../emulator/src/executor.js";
import { stateHash } from "../../emulator/src/commitments.js";
import type { Hash256 } from "../../abi/src/messages.js";
import type {
  RawAccountSnapshot,
  RawChainSnapshot,
  RawChainSource,
  RawMessageSnapshot,
  RawTransactionSnapshot,
  ReplayEvidence,
  V2VerificationExpectations,
  VerificationReport,
} from "./types.js";

export async function verifyRunFromSources(
  address: string,
  expectations: V2VerificationExpectations,
  sources: readonly RawChainSource[],
  replay?: ReplayEvidence,
): Promise<VerificationReport> {
  if (sources.length < 2) {
    return incompleteReport(expectations, sources.map((source) => source.id), "at least two independent sources are required");
  }
  const sourceIds = sources.map((source) => source.id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    return incompleteReport(expectations, sourceIds, "independent source identifiers must be distinct");
  }
  const snapshots = await Promise.all(sources.map((source) => source.fetchSnapshot(address)));
  const errors: string[] = [];
  const unresolved: string[] = [];
  const first = snapshots[0];
  if (first === undefined) return incompleteReport(expectations, sourceIds, "no source returned a snapshot");
  for (const snapshot of snapshots) {
    errors.push(...verifySnapshotIdentity(snapshot, expectations));
    errors.push(...verifyHistoryContinuity(snapshot.transactions));
  }
  const fingerprint = snapshotFingerprint(first);
  let providerAgreement = true;
  for (const snapshot of snapshots.slice(1)) {
    if (snapshotFingerprint(snapshot) !== fingerprint) {
      providerAgreement = false;
      errors.push(`provider disagreement: ${snapshot.source}`);
    }
  }

  let replayResult: ReplayResult | undefined;
  if (replay !== undefined && errors.length === 0) {
    errors.push(...verifyReplayConfiguration(replay, expectations));
    replayResult = replayTransactions(first.transactions, replay, expectations);
    errors.push(...replayResult.errors);
    unresolved.push(...replayResult.unresolved);
  } else if (replay === undefined) {
    unresolved.push("independent emulator replay was not supplied");
  }
  const counters = summarizeTransactions(first.transactions);
  const final = replayResult?.finalState;
  const deployment = deploymentSummary(first.account);
  const totalFeesNano = sumFees(first.transactions);
  const overall: VerificationReport["overall"] = errors.length > 0 ? "failed" : unresolved.length > 0 ? "incomplete" : "verified";
  const reportBase = {
    overall,
    network: expectations.network,
    address: Address.parse(expectations.address).toRawString(),
    sources: sourceIds,
    commitments: {
      programId: expectations.programId,
      runId: expectations.runId,
      romRoot: expectations.romRoot,
      routeRoot: expectations.routeRoot,
      staticCommitment: expectations.staticCommitment,
    },
    providerAgreement,
    acceptedAdvances: counters.acceptedAdvances,
    executedInstructions: replayResult?.executedInstructions ?? 0n,
    deliveredInputs: replayResult?.deliveredInputs ?? counters.deliveredInputs,
    duplicateDeliveries: replayResult?.duplicateDeliveries ?? counters.duplicateDeliveries,
    staleAttempts: counters.staleAttempts,
    stateSnapshotsChecked: replayResult?.stateSnapshotsChecked ?? 0,
    replayedMessageKinds: replayResult?.messageKinds ?? [],
    errors,
    unresolved,
    ...(final === undefined ? {} : { finalStateHash: stateHash(final), finalStatus: final.status, finalPc: final.pc, outputCommitment: final.outputCommitment }),
    ...(totalFeesNano === undefined ? {} : { totalFeesNano }),
  };
  return deployment === undefined ? reportBase : { ...reportBase, deployment };
}

export function verifySnapshotIdentity(snapshot: RawChainSnapshot, expectations: V2VerificationExpectations): string[] {
  const errors: string[] = [];
  errors.push(...verifyAccount(snapshot.account, expectations));
  if (snapshot.network !== expectations.network) errors.push(`network mismatch from ${snapshot.source}`);
  if (snapshot.transactions.length === 0) errors.push(`transaction history is empty from ${snapshot.source}`);
  return errors;
}

export function verifyAccount(account: RawAccountSnapshot, expectations: V2VerificationExpectations): string[] {
  const errors: string[] = [];
  let expectedAddress: Address | undefined;
  try {
    expectedAddress = Address.parse(expectations.address);
    if (Address.parse(account.address).toRawString() !== expectedAddress.toRawString()) errors.push("account address does not match expected address");
  } catch (error) {
    errors.push(`invalid account address: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (expectedAddress === undefined) return errors;
  if (account.codeBoc === undefined || account.dataBoc === undefined) {
    errors.push("account code/data BOC is missing");
  }
  if (account.codeBoc !== undefined && account.dataBoc !== undefined) {
    try {
      const code = firstCell(account.codeBoc);
      const data = firstCell(account.dataBoc);
      const codeHash = code.hash().toString("hex");
      const dataHash = data.hash().toString("hex");
      if (!sameHash(codeHash, expectations.codeHash)) errors.push("code hash mismatch");
      if (!sameHash(dataHash, expectations.dataHash)) errors.push("data hash mismatch");

      if (account.stateInitBoc === undefined) {
        errors.push("deployment StateInit BOC is missing");
      } else {
        const initCell = firstCell(account.stateInitBoc);
        if (!sameHash(initCell.hash().toString("hex"), expectations.stateInitHash)) errors.push("StateInit hash mismatch");
        const stateInit = loadStateInit(initCell.beginParse());
        if (stateInit.code == null || stateInit.data == null) {
          errors.push("StateInit lacks code or data");
        } else {
          const stateInitCodeHash = stateInit.code.hash().toString("hex");
          const stateInitDataHash = stateInit.data.hash().toString("hex");
          if (!sameHash(stateInitCodeHash, codeHash)) errors.push("StateInit code does not match account code");
          if (!sameHash(stateInitDataHash, dataHash)) errors.push("StateInit data does not match account data");
          if (!sameHash(stateInitCodeHash, expectations.codeHash)) errors.push("StateInit code hash mismatch");
          if (!sameHash(stateInitDataHash, expectations.dataHash)) errors.push("StateInit data hash mismatch");
          const derived = contractAddress(expectedAddress.workChain, stateInit).toRawString();
          if (derived !== expectedAddress.toRawString()) errors.push("StateInit-derived address mismatch");
        }
      }
    } catch (error) {
      errors.push(`invalid account BOC: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

export function verifyHistoryContinuity(transactions: readonly RawTransactionSnapshot[]): string[] {
  const errors: string[] = [];
  let previous: RawTransactionSnapshot | undefined;
  const seenHashes = new Set<string>();
  for (const transaction of transactions) {
    if (!/^[0-9a-f]{64}$/i.test(transaction.hash)) errors.push("transaction hash is not a 256-bit hexadecimal value");
    if (seenHashes.has(transaction.hash.toLowerCase())) errors.push(`transaction ${transaction.hash} appears more than once`);
    seenHashes.add(transaction.hash.toLowerCase());
    if (!/^\d+$/.test(transaction.lt)) errors.push(`transaction ${transaction.hash} has an invalid logical time`);
    if (previous !== undefined) {
      if (transaction.prevTransactionHash === undefined) errors.push(`history predecessor hash is missing at ${transaction.hash}`);
      else if (transaction.prevTransactionHash.toLowerCase() !== previous.hash.toLowerCase()) errors.push(`history link mismatch at ${transaction.hash}`);
      if (transaction.prevTransactionLt === undefined) errors.push(`history predecessor logical time is missing at ${transaction.hash}`);
      else if (transaction.prevTransactionLt !== previous.lt) errors.push(`history logical-time link mismatch at ${transaction.hash}`);
      if (BigInt(transaction.lt) <= BigInt(previous.lt)) errors.push(`history is not strictly ordered at ${transaction.hash}`);
    }
    previous = transaction;
  }
  return errors;
}

export function parseMessageBody(message: RawMessageSnapshot): { readonly message?: V2Message; readonly error?: string } {
  if (message.bodyBoc === undefined) return { error: "message body BOC is missing" };
  try {
    return { message: decodeV2Message(firstCell(message.bodyBoc)) };
  } catch (error) {
    return { error: `invalid v2 message body: ${error instanceof Error ? error.message : String(error)}` };
  }
}

interface ReplayResult {
  readonly finalState: ReplayEvidence["initialState"];
  readonly executedInstructions: bigint;
  readonly errors: readonly string[];
  readonly unresolved: readonly string[];
  readonly deliveredInputs: number;
  readonly duplicateDeliveries: number;
  readonly stateSnapshotsChecked: number;
  readonly messageKinds: readonly string[];
}

function replayTransactions(
  transactions: readonly RawTransactionSnapshot[],
  evidence: ReplayEvidence,
  expectations: V2VerificationExpectations,
): ReplayResult {
  let current = evidence.initialState;
  let executedInstructions = 0n;
  const errors: string[] = [];
  const unresolved: string[] = [];
  const messageKinds = new Set<string>();
  let deliveredInputs = 0;
  let duplicateDeliveries = 0;
  let stateSnapshotsChecked = 0;
  for (const transaction of transactions) {
    if (transaction.inbound === undefined) continue;
    const parsed = parseMessageBody(transaction.inbound);
    if (parsed.message === undefined) {
      if (transaction.success) errors.push(`successful transaction ${transaction.hash} has an undecodable inbound message`);
      continue;
    }
    const message = parsed.message;
    messageKinds.add(message.kind);
    if (message.runId.toLowerCase() !== expectations.runId.toLowerCase()) {
      errors.push(`run ID mismatch in transaction ${transaction.hash}`);
    }
    if (!transaction.success) continue;
    try {
      let stateChanged = false;
      switch (message.kind) {
        case "advance": {
          const request: V2AdvanceRequest = {
            queryId: message.queryId,
            expectedAdvanceCount: message.expectedAdvanceCount,
            expectedStateHash: message.expectedStateHash,
            maxInstructions: message.maxInstructions,
            maxOutputs: message.maxOutputs,
          };
          const result = advance(current, { rom: evidence.rom }, request);
          current = result.state;
          executedInstructions += BigInt(result.executed);
          stateChanged = true;
          break;
        }
        case "dispatchOutput":
          dispatchOutput(current, {
            queryId: message.queryId,
            expectedStateHash: message.expectedStateHash,
            outputId: message.outputId,
          });
          break;
        case "deliverInput": {
          const authenticatedPeer = authenticatedPeerId(transaction.inbound.source, evidence);
          if (authenticatedPeer === undefined) {
            unresolved.push(`authenticated source-core binding is missing at ${transaction.hash}`);
          }
          const delivery: DeliverInputMessage = { ...message };
          const result = deliverInput(current, delivery, authenticatedPeer ?? message.sourceCoreId);
          current = result.state;
          deliveredInputs += 1;
          if (result.duplicate) duplicateDeliveries += 1;
          stateChanged = !result.duplicate;
          const acknowledgement = transaction.outbound
            .map((outbound) => parseMessageBody(outbound).message)
            .find((outbound) => outbound?.kind === "inputAccepted" && outbound.outputId === message.outputId);
          if (acknowledgement === undefined) errors.push(`delivery ${transaction.hash} did not emit its acknowledgement`);
          break;
        }
        case "inputAccepted": {
          const authenticatedPeer = authenticatedPeerId(transaction.inbound.source, evidence);
          if (authenticatedPeer === undefined) {
            unresolved.push(`authenticated destination-core binding is missing at ${transaction.hash}`);
          }
          const result = acknowledgeOutput(current, { ...message }, authenticatedPeer ?? message.destinationCoreId);
          current = result.state;
          stateChanged = !result.duplicate;
          break;
        }
        case "topUp":
          break;
      }
      if (stateChanged) {
        stateSnapshotsChecked += 1;
        if (transaction.stateDataBoc === undefined) {
          unresolved.push(`post-state BOC is missing at ${transaction.hash}`);
        } else {
          const observed = stateHashFromBoc(transaction.stateDataBoc);
          if (!sameHash(observed, stateHash(current))) errors.push(`state hash mismatch after transaction ${transaction.hash}`);
        }
      }
    } catch (error) {
      errors.push(`replay failed at ${transaction.hash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    finalState: current,
    executedInstructions,
    errors,
    unresolved,
    deliveredInputs,
    duplicateDeliveries,
    stateSnapshotsChecked,
    messageKinds: [...messageKinds].sort(),
  };
}

function verifyReplayConfiguration(replay: ReplayEvidence, expectations: V2VerificationExpectations): string[] {
  const errors: string[] = [];
  const config = replay.initialState.config;
  if (!sameHash(config.runId, expectations.runId)) errors.push("replay run ID does not match expectations");
  if (!sameHash(config.programId, expectations.programId)) errors.push("replay program ID does not match expectations");
  if (!sameHash(config.romRoot, expectations.romRoot)) errors.push("replay ROM root does not match expectations");
  if (!sameHash(config.routeRoot, expectations.routeRoot)) errors.push("replay route root does not match expectations");
  if (!sameHash(config.staticCommitment, expectations.staticCommitment)) errors.push("replay static commitment does not match expectations");
  if (expectations.coreId !== undefined && config.coreId !== expectations.coreId) errors.push("replay core ID does not match expectations");
  if (expectations.maxStepsPerAdvance !== undefined && config.maxStepsPerAdvance !== expectations.maxStepsPerAdvance) {
    errors.push("replay max-steps limit does not match expectations");
  }
  if (replay.rom.length === 0) errors.push("replay ROM is empty");
  return errors;
}

function authenticatedPeerId(source: string | undefined, evidence: ReplayEvidence): number | undefined {
  if (source === undefined || evidence.peerIdsByAddress === undefined) return undefined;
  const direct = evidence.peerIdsByAddress[source];
  if (direct !== undefined) return direct;
  try {
    const normalized = Address.parse(source).toRawString();
    return evidence.peerIdsByAddress[normalized];
  } catch {
    return undefined;
  }
}

function stateHashFromBoc(boc: string): Hash256 {
  return firstCell(boc).hash().toString("hex");
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function firstCell(boc: string): Cell {
  const cells = Cell.fromBoc(Buffer.from(boc, "base64"));
  const cell = cells[0];
  if (cell === undefined) throw new Error("BOC did not contain a root cell");
  return cell;
}

function deploymentSummary(account: RawAccountSnapshot): VerificationReport["deployment"] {
  if (account.stateInitBoc === undefined) return undefined;
  const init = firstCell(account.stateInitBoc);
  const state = loadStateInit(init.beginParse());
  const stateInitHash = init.hash().toString("hex");
  const codeHash = state.code === null || state.code === undefined ? undefined : state.code.hash().toString("hex");
  const dataHash = state.data === null || state.data === undefined ? undefined : state.data.hash().toString("hex");
  return {
    stateInitHash,
    ...(codeHash === undefined ? {} : { codeHash }),
    ...(dataHash === undefined ? {} : { dataHash }),
  };
}

function summarizeTransactions(transactions: readonly RawTransactionSnapshot[]): { acceptedAdvances: number; deliveredInputs: number; duplicateDeliveries: number; staleAttempts: number } {
  let acceptedAdvances = 0;
  let deliveredInputs = 0;
  let duplicateDeliveries = 0;
  let staleAttempts = 0;
  for (const transaction of transactions) {
    const parsed = transaction.inbound === undefined ? undefined : parseMessageBody(transaction.inbound).message;
    if (parsed?.kind === "advance") {
      if (transaction.success) acceptedAdvances += 1;
      else if (transaction.exitCode === 120) staleAttempts += 1;
    }
    if (parsed?.kind === "deliverInput" && transaction.success) deliveredInputs += 1;
    if (parsed?.kind === "deliverInput" && transaction.success && transaction.outbound.some((message) => parseMessageBody(message).message?.kind === "inputAccepted")) {
      duplicateDeliveries += transaction.outbound.filter((message) => parseMessageBody(message).message?.kind === "inputAccepted").length > 1 ? 1 : 0;
    }
  }
  return { acceptedAdvances, deliveredInputs, duplicateDeliveries, staleAttempts };
}

function sumFees(transactions: readonly RawTransactionSnapshot[]): string | undefined {
  let total = 0n;
  let found = false;
  for (const transaction of transactions) {
    if (transaction.feesNano === undefined) continue;
    total += BigInt(transaction.feesNano);
    found = true;
  }
  return found ? total.toString() : undefined;
}

function snapshotFingerprint(snapshot: RawChainSnapshot): string {
  return JSON.stringify({
    network: snapshot.network,
    account: snapshot.account,
    transactions: snapshot.transactions,
  });
}

function incompleteReport(expectations: V2VerificationExpectations, sources: readonly string[], reason: string): VerificationReport {
  return {
    overall: "incomplete",
    network: expectations.network,
    address: expectations.address,
    sources,
    commitments: {
      programId: expectations.programId,
      runId: expectations.runId,
      romRoot: expectations.romRoot,
      routeRoot: expectations.routeRoot,
      staticCommitment: expectations.staticCommitment,
    },
    providerAgreement: false,
    acceptedAdvances: 0,
    executedInstructions: 0n,
    deliveredInputs: 0,
    duplicateDeliveries: 0,
    staleAttempts: 0,
    stateSnapshotsChecked: 0,
    replayedMessageKinds: [],
    errors: [],
    unresolved: [reason],
  };
}
