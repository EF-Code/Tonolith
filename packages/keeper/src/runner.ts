import type { KeeperCoreConfig, KeeperCoreObservation, KeeperProvider, KeeperRunResult, KeeperWallet } from "./types.js";
import { KeeperSafetyError, planNextAction } from "./planner.js";

export async function runKeeperOnce(
  config: KeeperCoreConfig,
  provider: KeeperProvider,
  wallet?: KeeperWallet,
  queryId = 0n,
): Promise<KeeperRunResult> {
  let observation: KeeperCoreObservation;
  try {
    observation = await provider.readCore(config.address);
    const action = planNextAction(config, observation, queryId);
    if (action === undefined) return { provider: provider.id, ...(wallet === undefined ? {} : { wallet: wallet.id }), errors: [] };
    if (wallet === undefined) return { provider: provider.id, action, errors: [] };
    const submission = await wallet.submitInternal(action.address, action.bodyBoc, action.valueNano);
    if (!submission.acceptedByRpc || submission.transactionHash === undefined) {
      return { provider: provider.id, wallet: wallet.id, action, submission, finalized: false, errors: ["RPC acceptance or transaction hash was unavailable; no retry was attempted"] };
    }
    const finality = await wallet.waitForFinality(submission.transactionHash);
    return { provider: provider.id, wallet: wallet.id, action, submission, finalized: finality.finalized, errors: finality.finalized ? [] : ["transaction was not masterchain-finalized"] };
  } catch (error) {
    const message = error instanceof KeeperSafetyError ? error.message : error instanceof Error ? error.message : String(error);
    return { provider: provider.id, ...(wallet === undefined ? {} : { wallet: wallet.id }), errors: [message] };
  }
}
