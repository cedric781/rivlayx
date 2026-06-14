import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { VelocityInput } from './types';
import { clamp01 } from './util';

/**
 * Velocity-anomaly — pure. Compares a recent window against the user's own
 * trailing baseline on three axes (bet frequency, volume, stake size) and takes
 * the strongest spike.
 *
 * New-account suppression: with no usable baseline the signal is 0 — onboarding
 * ramp-up is not an anomaly. This is a core false-positive guard.
 */
export function computeVelocitySignal(
  input: VelocityInput,
  config: RiskConfig = RISK_DEFAULTS,
): number {
  const v = config.velocity;
  // `hasBaseline` is set by the caller from the RAW baseline count against
  // `minBaselineBets`; `baselineBets` here may be a scaled rate, so we must not
  // re-gate on it (that would wrongly suppress genuine spikes).
  if (!input.hasBaseline || input.baselineBets <= 0) return 0;

  const ratio = (recent: number, baseline: number): number => {
    if (baseline <= 0) return 0;
    const spike = recent / baseline; // 1 = steady
    return clamp01((spike - 1) / (v.spikeSaturation - 1));
  };

  const freqSpike = ratio(input.recentBets, input.baselineBets);
  const volumeSpike = ratio(input.recentVolumeUsdc, input.baselineVolumeUsdc);
  const stakeSpike = ratio(input.recentAvgStakeUsdc, input.baselineAvgStakeUsdc);

  return clamp01(Math.max(freqSpike, volumeSpike, stakeSpike));
}
