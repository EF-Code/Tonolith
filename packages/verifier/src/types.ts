import type { Cell } from "@ton/core";
import type { Hash256 } from "../../abi/src/messages.js";

export interface RawAccountSnapshot {
  readonly address: string;
  readonly balanceNano?: string;
  readonly codeBoc?: string;
  readonly dataBoc?: string;
  readonly stateInitBoc?: string;
  readonly lastTransaction?: { readonly hash: string; readonly lt: string };
}

export interface RawMessageSnapshot {
  readonly direction: "in" | "out";
  readonly source?: string;
  readonly destination?: string;
  readonly valueNano?: string;
  readonly bodyBoc?: string;
  readonly bounced?: boolean;
}

export interface RawTransactionSnapshot {
  readonly hash: string;
  readonly lt: string;
  readonly prevTransactionHash?: string;
  readonly prevTransactionLt?: string;
  readonly success: boolean;
  readonly exitCode?: number;
  readonly inbound?: RawMessageSnapshot;
  readonly outbound: readonly RawMessageSnapshot[];
  readonly stateDataBoc?: string;
  readonly feesNano?: string;
}

export interface RawChainSnapshot {
  readonly source: string;
  readonly network: string;
  readonly account: RawAccountSnapshot;
  readonly transactions: readonly RawTransactionSnapshot[];
}

export interface RawChainSource {
  readonly id: string;
  fetchSnapshot(address: string): Promise<RawChainSnapshot>;
}

export interface V2VerificationExpectations {
  readonly address: string;
  readonly network: string;
  readonly codeHash: Hash256;
  readonly dataHash: Hash256;
  readonly stateInitHash: Hash256;
  readonly programId: Hash256;
  readonly runId: Hash256;
  readonly romRoot: Hash256;
  readonly routeRoot: Hash256;
  readonly staticCommitment: Hash256;
}

export interface ReplayEvidence {
  readonly initialState: import("../../emulator/src/model.js").V2State;
  readonly rom: readonly number[];
}

export interface VerificationReport {
  readonly overall: "verified" | "failed" | "incomplete";
  readonly network: string;
  readonly address: string;
  readonly sources: readonly string[];
  readonly deployment?: {
    readonly transactionHash?: string;
    readonly transactionLt?: string;
    readonly codeHash?: Hash256;
    readonly dataHash?: Hash256;
    readonly stateInitHash?: Hash256;
  };
  readonly acceptedAdvances: number;
  readonly executedInstructions: bigint;
  readonly deliveredInputs: number;
  readonly duplicateDeliveries: number;
  readonly staleAttempts: number;
  readonly finalStateHash?: Hash256;
  readonly finalStatus?: number;
  readonly finalPc?: number;
  readonly outputCommitment?: Hash256;
  readonly totalFeesNano?: string;
  readonly errors: readonly string[];
  readonly unresolved: readonly string[];
}

export interface ParsedBody {
  readonly kind: string;
  readonly cell: Cell;
}
