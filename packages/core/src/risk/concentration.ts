import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { ConcentrationInput } from './types';
import { clamp01 } from './util';

/**
 * Counterparty-concentration — pure. A Herfindahl–Hirschman index over a user's
 * counterparties by settled volume. HHI ≈ 1 → all activity funnels through one
 * party (alt-loop); spread counterparties → low. A `floor` removes credit for
 * naturally low-N new users.
 */
export function computeConcentrationSignal(
  input: ConcentrationInput,
  config: RiskConfig = RISK_DEFAULTS,
): number {
  const c = config.concentration;
  const volumes = input.counterpartyVolumesUsdc.filter((v) => v > 0);
  if (volumes.length < Math.max(1, c.minCounterparties)) return 0;

  const total = volumes.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;

  const hhi = volumes.reduce((s, v) => s + (v / total) ** 2, 0); // (0,1]
  if (hhi <= c.hhiFloor) return 0;
  return clamp01((hhi - c.hhiFloor) / (1 - c.hhiFloor));
}
