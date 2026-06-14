import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { AbuseInput } from './types';
import { clamp01 } from './util';

/**
 * Dispute-abuse — pure. Blends a (Laplace-smoothed) frivolous rate, a
 * disproportionate dispute volume relative to the platform baseline, and
 * pattern concentration (repeatedly targeting the same counterparty/arbiter).
 *
 *   abuseSignal = 0.45·frivolous + 0.30·excess + 0.25·pattern
 */
export function computeAbuseSignal(input: AbuseInput, config: RiskConfig = RISK_DEFAULTS): number {
  const ab = config.abuse;

  const frivolousRate = input.disputesOpened > 0
    ? input.rejectedDisputes / (input.disputesOpened + ab.smoothing)
    : 0;

  const disputeRate = input.matchedBets > 0 ? input.disputesOpened / input.matchedBets : 0;
  const excess = ab.baselineDisputeRate > 0
    ? clamp01((disputeRate - ab.baselineDisputeRate) / (1 - ab.baselineDisputeRate))
    : 0;

  return clamp01(
    ab.frivolousWeight * clamp01(frivolousRate) +
      ab.excessWeight * excess +
      ab.patternWeight * clamp01(input.patternConcentration),
  );
}
