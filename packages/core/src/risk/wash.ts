import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { WashInput } from './types';
import { clamp01, norm } from './util';

/**
 * Wash-trading — pure. High reciprocity (round-trips) AND near-zero net
 * exposure AND meaningful volume → money circling between two accounts. Any one
 * alone is insufficient (a single lost rematch is not wash).
 *
 *   washSignal = reciprocity · (1 − netExposureRatio) · volumeWeight
 */
export function computeWashSignal(input: WashInput, config: RiskConfig = RISK_DEFAULTS): number {
  const w = config.wash;
  if (input.roundTrips < w.minRoundTrips) return 0;

  // Reciprocity saturates as round-trips climb past the minimum.
  const reciprocity = norm(input.roundTrips, w.minRoundTrips * 3);
  const balance = clamp01(1 - clamp01(input.netExposureRatio));
  const volumeWeight = norm(input.reciprocalVolumeUsdc, w.volumeTargetUsdc);

  return clamp01(reciprocity * balance * volumeWeight);
}
