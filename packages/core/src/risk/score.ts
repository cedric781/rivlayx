import type { RiskBand } from '@rivlayx/db';
import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { RiskResult, RiskScoreInput } from './types';
import { clamp, clamp01, round0to100 } from './util';

function bandForScore(score: number, config: RiskConfig): RiskBand {
  for (const b of config.bands) {
    if (score >= b.min) return b.band;
  }
  return 'none';
}

/** Highest band index that the activity gate permits (caps at `low`). */
function capBand(band: RiskBand): RiskBand {
  const order: RiskBand[] = ['none', 'low', 'elevated', 'high', 'critical'];
  return order.indexOf(band) > order.indexOf('low') ? 'low' : band;
}

/**
 * Pure risk scoring — signals in → composite + band out. No DB, no clock, no
 * I/O, so detection is fully unit-testable. **Advisory only: this never
 * triggers an action.** See `docs/risk-engine-design.md` §4.
 *
 *   primary = 0.28·ring + 0.16·arbiterConc + 0.16·conc + 0.16·wash
 *           + 0.14·abuse + 0.10·velocity                       (each [0,1])
 *   fundingBoost = (primary ≥ 0.40) ? min(0.05, 0.05·funding) : 0
 *   risk_score = round(100 · clamp(primary + fundingBoost, 0, 1))
 *
 * Funding overlap is supporting-only: gated on an already-elevated primary and
 * hard-capped at +5 points, so it can never on its own create risk. Thin
 * accounts are capped at the `low` band by the activity gate.
 */
export function computeRiskScore(
  input: RiskScoreInput,
  config: RiskConfig = RISK_DEFAULTS,
): RiskResult {
  const w = config.weights;

  const ring = clamp01(input.ringSignal);
  const arbiterConcentration = clamp01(input.arbiterConcentrationSignal);
  const concentration = clamp01(input.concentrationSignal);
  const wash = clamp01(input.washSignal);
  const abuse = clamp01(input.abuseSignal);
  const velocity = clamp01(input.velocitySignal);
  const funding = clamp01(input.fundingSignal);

  const primary =
    w.ring * ring +
    w.arbiterConcentration * arbiterConcentration +
    w.concentration * concentration +
    w.wash * wash +
    w.abuse * abuse +
    w.velocity * velocity;

  const fundingBoost =
    primary >= config.funding.minPrimaryForBoost
      ? Math.min(config.funding.maxBoost, config.funding.maxBoost * funding)
      : 0;

  const riskScore = round0to100(clamp01(primary + fundingBoost));

  let band = bandForScore(riskScore, config);
  const activityGated =
    input.matchedBets < config.activityGate.minMatchedBets ||
    input.ageDays < config.activityGate.minAgeDays;
  if (activityGated) band = capBand(band);

  return {
    riskScore,
    band,
    subScores: {
      ring: round0to100(ring),
      arbiterConcentration: round0to100(arbiterConcentration),
      concentration: round0to100(concentration),
      wash: round0to100(wash),
      abuse: round0to100(abuse),
      velocity: round0to100(velocity),
      fundingOverlap: round0to100(funding),
    },
    primary: clamp(primary, 0, 1),
    fundingBoost,
    activityGated,
  };
}
