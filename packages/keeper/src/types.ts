import type { Hash256 } from "../../abi/src/messages.js";
import type { CoreStatus } from "../../isa/src/constants.js";

export interface KeeperCoreConfig {
  readonly address: string;
  readonly runId: Hash256;
  readonly codeHash: Hash256;
  readonly network: "testnet";
  readonly maxInstructions: number;
  readonly maxOutputs: number;
  readonly dispatchValueNano: bigint;
}

export interface PendingOutputObservation {
  readonly outputId: Hash256;
}

export interface KeeperCoreObservation {
  readonly address: string;
  readonly network: "testnet";
  readonly codeHash: Hash256;
  readonly runId: Hash256;
  readonly stateHash: Hash256;
  readonly advanceCount: bigint;
  readonly status: CoreStatus;
  readonly pendingOutputs: readonly PendingOutputObservation[];
  readonly inputCount: bigint;
}

export interface KeeperProvider {
  readonly id: string;
  readCore(address: string): Promise<KeeperCoreObservation>;
}

export interface KeeperSubmission {
  readonly transactionHash?: string;
  readonly acceptedByRpc: boolean;
}

export interface KeeperWallet {
  readonly id: string;
  submitInternal(address: string, bodyBoc: string, valueNano: bigint): Promise<KeeperSubmission>;
  waitForFinality(transactionHash: string): Promise<{ readonly finalized: boolean; readonly stateHash?: Hash256 }>;
}

export type KeeperActionKind = "dispatchOutput" | "advance";

export interface KeeperAction {
  readonly kind: KeeperActionKind;
  readonly address: string;
  readonly runId: Hash256;
  readonly expectedStateHash: Hash256;
  readonly expectedAdvanceCount?: bigint;
  readonly outputId?: Hash256;
  readonly bodyBoc: string;
  readonly valueNano: bigint;
  readonly reason: "delivery-priority" | "advance-runnable";
}

export interface KeeperRunResult {
  readonly provider: string;
  readonly wallet?: string;
  readonly action?: KeeperAction;
  readonly submission?: KeeperSubmission;
  readonly finalized?: boolean;
  readonly errors: readonly string[];
}
