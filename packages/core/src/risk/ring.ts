import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { RingInput } from './types';
import { clamp01 } from './util';

/**
 * Ring detection — pure. Blends cluster cohesion, repeated-counterparty
 * concentration and arbiter overlap. Gated by minimum cluster activity so a
 * single low-stake bet between two friends is never a ring.
 *
 *   ringSignal = 0.40·cohesion + 0.30·repeatedCp + 0.30·arbiterOverlap
 */
export function computeRingSignal(input: RingInput, config: RiskConfig = RISK_DEFAULTS): number {
  const r = config.ring;
  const active =
    input.clusterSize >= r.minClusterSize && input.clusterVolumeUsdc >= r.minClusterVolumeUsdc;
  if (!active) return 0;

  return clamp01(
    r.cohesionWeight * clamp01(input.cohesion) +
      r.repeatedCounterpartyWeight * clamp01(input.repeatedCounterpartyRatio) +
      r.arbiterOverlapWeight * clamp01(input.arbiterOverlap),
  );
}
