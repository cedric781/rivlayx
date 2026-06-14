import type { ReputationTier } from '@rivlayx/db';
import { REPUTATION_DEFAULTS, type ReputationConfig } from './config';
import type {
  ArbiterReputationResult,
  ArbiterSignals,
  ReputationResult,
  ReputationSignals,
} from './types';

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

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

/**
 * Pure arbiter (adjudicator) scoring — hardened in Sprint 16.5.
 *
 * The continuous score blends accuracy (1 − overturned), acceptance,
 * independence (distinct participants), experience (rulings) and a small
 * platform-selected bonus. But tier is gated by **hard independence thresholds**
 * so self-assigned alt-account farming cannot reach Gold/Trusted no matter how
 * clean the record looks:
 *   - provisional ("New") unless rulings ≥ 10 AND distinctCreators ≥ 10 AND
 *     distinctParticipants ≥ 10
 *   - Trusted requires rulings ≥ 25, distinctCreators ≥ 15,
 *     distinctParticipants ≥ 25, overturnedRate ≤ 2%
 *   - Gold requires rulings ≥ 10, distinctCreators ≥ 5, distinctParticipants ≥ 10
 */
export function computeArbiterReputation(
  signals: ArbiterSignals,
  config: ReputationConfig = REPUTATION_DEFAULTS,
): ArbiterReputationResult {
  const a = config.arbiter;
  const decided = signals.accepted + signals.declined;
  const acceptanceRate = decided > 0 ? signals.accepted / decided : 0;
  const overturnedRate = signals.rulings > 0 ? signals.overturned / signals.rulings : 0;

  const accuracy = 1 - overturnedRate;
  const experience = norm(signals.rulings, a.rulingsTarget);
  const independence = norm(signals.distinctParticipants, a.participantsTarget);
  const platformShare = signals.rulings > 0 ? signals.platformRulings / signals.rulings : 0;

  const positive =
    a.weights.accuracy * accuracy +
    a.weights.acceptance * acceptanceRate +
    a.weights.independence * independence +
    a.weights.experience * experience +
    a.weights.platform * platformShare;
  const arbiterScore = clamp(Math.round(100 * positive), 0, 100);

  const arbiterProvisional =
    signals.rulings < a.provisional.minRulings ||
    signals.distinctCreators < a.provisional.minDistinctCreators ||
    signals.distinctParticipants < a.provisional.minDistinctParticipants;

  const eligibleTrusted =
    signals.rulings >= a.trusted.minRulings &&
    signals.distinctCreators >= a.trusted.minDistinctCreators &&
    signals.distinctParticipants >= a.trusted.minDistinctParticipants &&
    overturnedRate <= a.trusted.maxOverturnedRate;
  const eligibleGold =
    signals.rulings >= a.gold.minRulings &&
    signals.distinctCreators >= a.gold.minDistinctCreators &&
    signals.distinctParticipants >= a.gold.minDistinctParticipants;

  let arbiterTier: ReputationTier;
  if (arbiterProvisional) {
    arbiterTier = 'new';
  } else {
    let t = tierForScore(arbiterScore, config);
    // Cap by hard independence/accuracy eligibility.
    if (t === 'trusted' && !eligibleTrusted) t = 'gold';
    if ((t === 'trusted' || t === 'gold') && !eligibleGold) t = 'silver';
    arbiterTier = t;
  }

  return {
    arbiterScore,
    arbiterTier,
    arbiterProvisional,
    arbiterRulings: signals.rulings,
    overturnedRate: round4(overturnedRate),
    acceptanceRate: round4(acceptanceRate),
  };
}
