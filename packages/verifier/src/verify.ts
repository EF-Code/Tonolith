import { Address, Cell, contractAddress, loadStateInit } from "@ton/core";
import { decodeV2Message, type V2Message } from "../../abi/src/messages.js";
import { advance, type V2AdvanceRequest } from "../../emulator/src/executor.js";
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
  const snapshots = await Promise.all(sources.map((source) => source.fetchSnapshot(address)));
  const errors: string[] = [];
  const unresolved: string[] = [];
  const first = snapshots[0];
  if (first === undefined) return incompleteReport(expectations, sources.map((source) => source.id), "no source returned a snapshot");
  for (const snapshot of snapshots) {
    errors.push(...verifySnapshotIdentity(snapshot, expectations));
    errors.push(...verifyHistoryContinuity(snapshot.transactions));
  }
  const fingerprint = snapshotFingerprint(first);
  for (const snapshot of snapshots.slice(1)) {
    if (snapshotFingerprint(snapshot) !== fingerprint) errors.push(`provider disagreement: ${snapshot.source}`);
  }

  let replayResult: ReplayResult | undefined;
  if (replay !== undefined && errors.length === 0) {
    replayResult = replayAcceptedAdvances(first.transactions, replay);
    errors.push(...replayResult.errors);
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
    sources: sources.map((source) => source.id),
    acceptedAdvances: counters.acceptedAdvances,
    executedInstructions: replayResult?.executedInstructions ?? 0n,
    deliveredInputs: counters.deliveredInputs,
    duplicateDeliveries: counters.duplicateDeliveries,
    staleAttempts: counters.staleAttempts,
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
    return errors;
  }
  try {
    const code = firstCell(account.codeBoc);
    const data = firstCell(account.dataBoc);
    const codeHash = code.hash().toString("hex");
    const dataHash = data.hash().toString("hex");
    if (codeHash !== expectations.codeHash) errors.push("code hash mismatch");
    if (dataHash !== expectations.dataHash) errors.push("data hash mismatch");
    const initCell = account.stateInitBoc === undefined ? undefined : firstCell(account.stateInitBoc);
    if (initCell !== undefined) {
      const stateInit = loadStateInit(initCell.beginParse());
      if (stateInit.code === undefined || stateInit.data === undefined) errors.push("StateInit lacks code or data");
      else {
        const derived = contractAddress(expectedAddress.workChain, stateInit).toRawString();
        if (derived !== expectedAddress.toRawString()) errors.push("StateInit-derived address mismatch");
        if (initCell.hash().toString("hex") !== expectations.stateInitHash) errors.push("StateInit hash mismatch");
      }
    } else {
      errors.push("deployment StateInit BOC is missing");
    }
  } catch (error) {
    errors.push(`invalid account BOC: ${error instanceof Error ? error.message : String(error)}`);
  }
  return errors;
}

export function verifyHistoryContinuity(transactions: readonly RawTransactionSnapshot[]): string[] {
  const errors: string[] = [];
  let previous: RawTransactionSnapshot | undefined;
  for (const transaction of transactions) {
    if (!/^[0-9a-f]+$/i.test(transaction.hash)) errors.push("transaction hash is not hexadecimal");
    if (!/^\d+$/.test(transaction.lt)) errors.push(`transaction ${transaction.hash} has an invalid logical time`);
    if (previous !== undefined) {
      if (transaction.prevTransactionHash !== undefined && transaction.prevTransactionHash !== previous.hash) errors.push(`history link mismatch at ${transaction.hash}`);
      if (transaction.prevTransactionLt !== undefined && transaction.prevTransactionLt !== previous.lt) errors.push(`history logical-time link mismatch at ${transaction.hash}`);
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
}

function replayAcceptedAdvances(transactions: readonly RawTransactionSnapshot[], evidence: ReplayEvidence): ReplayResult {
  let current = evidence.initialState;
  let executedInstructions = 0n;
  const errors: string[] = [];
  for (const transaction of transactions) {
    if (!transaction.success || transaction.inbound === undefined) continue;
    const parsed = parseMessageBody(transaction.inbound);
    if (parsed.message?.kind !== "advance") continue;
    const request: V2AdvanceRequest = {
      queryId: parsed.message.queryId,
      expectedAdvanceCount: parsed.message.expectedAdvanceCount,
      expectedStateHash: parsed.message.expectedStateHash,
      maxInstructions: parsed.message.maxInstructions,
      maxOutputs: parsed.message.maxOutputs,
    };
    try {
      const result = advance(current, { rom: evidence.rom }, request);
      current = result.state;
      executedInstructions += BigInt(result.executed);
      const observed = transaction.stateDataBoc === undefined ? undefined : stateHashFromBoc(transaction.stateDataBoc);
      if (observed !== undefined && observed !== stateHash(current)) errors.push(`state hash mismatch after transaction ${transaction.hash}`);
    } catch (error) {
      errors.push(`replay failed at ${transaction.hash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { finalState: current, executedInstructions, errors };
}

function stateHashFromBoc(boc: string): Hash256 {
  return firstCell(boc).hash().toString("hex");
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
    acceptedAdvances: 0,
    executedInstructions: 0n,
    deliveredInputs: 0,
    duplicateDeliveries: 0,
    staleAttempts: 0,
    errors: [],
    unresolved: [reason],
  };
}
