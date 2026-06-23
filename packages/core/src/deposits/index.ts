export { DEPOSIT_DEFAULTS, REQUIRED_CONFIRMATIONS, type DepositConfig } from './config';
export { computeCurrentTvl, wouldExceedTvlCap, type TvlCheckResult } from './tvl';
export { detectDeposit, type DetectResult } from './detect';
export { confirmDeposit, type ConfirmResult } from './confirm';
export { creditDeposit, type CreditResult } from './credit';
export { reconcileVault, type VaultReconciliationInput } from './reconcile';
export {
  processPendingDeposits,
  type ProcessPendingDepositsOptions,
  type ProcessPendingDepositsResult,
} from './poll';
