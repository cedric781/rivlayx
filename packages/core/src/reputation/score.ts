import type { ReputationTier } from '@rivlayx/db';
import { REPUTATION_DEFAULTS, type ReputationConfig } from './config';
import type { ReputationResult, ReputationSignals } from './types';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Log-scaled normalisation to [0,1] with `target` ≈ full credit. */
function norm(x: number, target: number): number {
  if (target <= 0) return 0;
  return clamp(Math.log1p(Math.max(0, x)) / Math.log1p(target), 0, 1);
}

function tierForScore(score: number, config: ReputationConfig): Exclude<ReputationTier, 'new'> {
  for (const band of config.tierBands) {
    if (score >= band.min) return band.tier;
  }
  return 'untrusted';
}

/**
 * Pure reputation scoring: signals in → result out. No DB, no clock, no I/O —
 * so fraud-resistance is fully unit-testable. See `docs/reputation-design.md`.
 *
 *   score = round(100 · P · I), then status modifier
 *   P = 0.40·exp + 0.20·comp + 0.20·vol + 0.15·age + 0.05·win   (each in [0,1])
 *   I = clamp(1 − (2·frivolousRate + 3·adverseRate), floor, 1)  (multiplicative)
 */
export function computeReputation(
  signals: ReputationSignals,
  config: ReputationConfig = REPUTATION_DEFAULTS,
): ReputationResult {
  const { weights, targets, integrity: ig, provisional: pv } = config;

  const exp = norm(signals.distinctCounterparties, targets.distinctCounterparties);
  const comp = norm(signals.completedBets, targets.completedBets);
  const vol = norm(Number(signals.cappedSettledVolumeUsdc), targets.settledVolumeUsdc);
  const activityGate = Math.min(1, signals.completedBets / 3);
  const age = norm(signals.ageDays, targets.ageDays) * activityGate;

  const decided = signals.wins + signals.losses;
  // Laplace-smoothed win ratio, neutral 0.5 for low samples. Capped weight (5%).
  const win = (signals.wins + 1) / (decided + 2);

  const positive =
    weights.exp * exp +
    weights.comp * comp +
    weights.vol * vol +
    weights.age * age +
    weights.win * win;

  const denom = signals.matchedBets + ig.smoothing;
  const frivolousRate = signals.frivolousDisputes / denom;
  const adverseRate = signals.adverseDisputes / denom;
  const integrityFactor = clamp(
    1 - (ig.frivolousWeight * frivolousRate + ig.adverseWeight * adverseRate),
    ig.floor,
    1,
  );

  const rawRate = decided > 0 ? signals.wins / decided : 0;
  const winRateAnomaly =
    decided >= config.winAnomaly.minSample &&
    (rawRate >= config.winAnomaly.highRate || rawRate <= config.winAnomaly.lowRate);

  let score = Math.round(100 * positive * integrityFactor);
  if (signals.status === 'banned' || signals.status === 'deleted') {
    score = 0;
  } else if (signals.status === 'suspended') {
    score = Math.min(score, config.suspendedScoreCap);
  }
  score = clamp(score, 0, 100);

  // Provisional only applies to active accounts with too little data. A
  // suspended/banned account has a determined state, not a "New" one.
  const meetsThresholds =
    signals.matchedBets >= pv.minMatched &&
    signals.distinctCounterparties >= pv.minDistinctCounterparties &&
    signals.ageDays >= pv.minAgeDays &&
    signals.completedBets >= pv.minCompleted;
  const provisional = signals.status === 'active' ? !meetsThresholds : false;

  const tier: ReputationTier = provisional ? 'new' : tierForScore(score, config);

  return {
    score,
    tier,
    provisional,
    components: {
      subScores: { exp, comp, vol, age, win },
      positive,
      integrity: integrityFactor,
      winRateAnomaly,
      signals,
    },
  };
}
