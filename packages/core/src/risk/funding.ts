import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { FundingOverlapInput } from './types';
import { norm } from './util';

/**
 * Funding-overlap — pure. **Supporting signal only.** Distinct users sharing a
 * deposit source wallet. This is deliberately NOT a primary factor: exchanges,
 * families, friends and shared custodial wallets legitimately overlap, so this
 * signal is gated and hard-capped in the combiner (`score.ts`) and known
 * exchange/custodial wallets are excluded upstream (`signals.ts`). Here it is
 * simply normalised; it can never on its own raise risk.
 */
export function computeFundingOverlapSignal(
  input: FundingOverlapInput,
  config: RiskConfig = RISK_DEFAULTS,
): number {
  return norm(input.sharedSourceUsers, config.funding.saturationUsers);
}
