import { describe, expect, it } from 'vitest';
import { computeRiskScore } from './score';
import { computeRingSignal } from './ring';
import { computeArbiterConcentrationSignal } from './arbiter-concentration';
import { computeConcentrationSignal } from './concentration';
import { computeWashSignal } from './wash';
import { computeAbuseSignal } from './abuse';
import { computeVelocitySignal } from './velocity';
import { computeFundingOverlapSignal } from './funding';
import { computeSybilConfidence } from './sybil';
import type { RiskScoreInput } from './types';

function input(overrides: Partial<RiskScoreInput> = {}): RiskScoreInput {
  return {
    ringSignal: 0,
    arbiterConcentrationSignal: 0,
    concentrationSignal: 0,
    washSignal: 0,
    abuseSignal: 0,
    velocitySignal: 0,
    fundingSignal: 0,
    matchedBets: 10,
    ageDays: 30,
    ...overrides,
  };
}

describe('computeRiskScore — composite + bands', () => {
  it('all-zero signals → score 0, band none', () => {
    const r = computeRiskScore(input());
    expect(r.riskScore).toBe(0);
    expect(r.band).toBe('none');
  });

  it('weights sum to 1 (full signals → score 100, critical)', () => {
    const r = computeRiskScore(
      input({
        ringSignal: 1,
        arbiterConcentrationSignal: 1,
        concentrationSignal: 1,
        washSignal: 1,
        abuseSignal: 1,
        velocitySignal: 1,
      }),
    );
    expect(r.riskScore).toBe(100);
    expect(r.band).toBe('critical');
  });

  it('ring is the heaviest single factor (0.28)', () => {
    expect(computeRiskScore(input({ ringSignal: 1 })).riskScore).toBe(28);
    expect(computeRiskScore(input({ arbiterConcentrationSignal: 1 })).riskScore).toBe(16);
    expect(computeRiskScore(input({ velocitySignal: 1 })).riskScore).toBe(10);
  });

  it('band thresholds map correctly', () => {
    // ring 1 + wash 1 → primary 0.44 → 44 → elevated
    expect(computeRiskScore(input({ ringSignal: 1, washSignal: 1 })).band).toBe('elevated');
  });
});

describe('funding overlap — supporting only, never primary', () => {
  it('funding alone never creates risk (no primary signal)', () => {
    const r = computeRiskScore(input({ fundingSignal: 1 }));
    expect(r.riskScore).toBe(0);
    expect(r.fundingBoost).toBe(0);
    expect(r.band).toBe('none');
  });

  it('funding does not boost a below-threshold primary', () => {
    // ring 1 → primary 0.28 < 0.40 gate → no boost
    const r = computeRiskScore(input({ ringSignal: 1, fundingSignal: 1 }));
    expect(r.fundingBoost).toBe(0);
    expect(r.riskScore).toBe(28);
  });

  it('funding adds at most +5 once primary is already elevated', () => {
    const base = computeRiskScore(input({ ringSignal: 1, washSignal: 1 }));
    const boosted = computeRiskScore(input({ ringSignal: 1, washSignal: 1, fundingSignal: 1 }));
    expect(boosted.fundingBoost).toBeCloseTo(0.05, 5);
    expect(boosted.riskScore - base.riskScore).toBe(5);
  });
});

describe('activity gate — thin accounts capped at low', () => {
  it('caps the band at low regardless of score for thin accounts', () => {
    const r = computeRiskScore(input({ ringSignal: 1, washSignal: 1, matchedBets: 0, ageDays: 0 }));
    expect(r.activityGated).toBe(true);
    expect(r.band).toBe('low'); // would be elevated (44) without the gate
  });
});

describe('detector: ring', () => {
  it('suppressed below minimum cluster activity', () => {
    expect(
      computeRingSignal({
        cohesion: 1,
        repeatedCounterpartyRatio: 1,
        arbiterOverlap: 1,
        clusterSize: 2,
        clusterVolumeUsdc: 10,
      }),
    ).toBe(0);
  });
  it('high for a cohesive, repetitive, arbiter-overlapping cluster', () => {
    const s = computeRingSignal({
      cohesion: 1,
      repeatedCounterpartyRatio: 1,
      arbiterOverlap: 1,
      clusterSize: 4,
      clusterVolumeUsdc: 1000,
    });
    expect(s).toBeCloseTo(1, 5);
  });
});

describe('detector: arbiter concentration', () => {
  it('suppressed below the ruled-bets gate', () => {
    expect(
      computeArbiterConcentrationSignal({
        creatorArbiterShare: 1,
        acceptorArbiterShare: 1,
        clusterArbiterShare: 1,
        ruledBetsConsidered: 2,
      }),
    ).toBe(0);
  });
  it('high when one captive arbiter dominates', () => {
    const s = computeArbiterConcentrationSignal({
      creatorArbiterShare: 1,
      acceptorArbiterShare: 1,
      clusterArbiterShare: 1,
      ruledBetsConsidered: 20,
    });
    expect(s).toBeCloseTo(1, 5);
  });
});

describe('detector: counterparty concentration', () => {
  it('one counterparty → high HHI signal', () => {
    expect(computeConcentrationSignal({ counterpartyVolumesUsdc: [1000] })).toBeGreaterThan(0.9);
  });
  it('many equal counterparties → low', () => {
    const spread = Array.from({ length: 20 }, () => 50);
    expect(computeConcentrationSignal({ counterpartyVolumesUsdc: spread })).toBe(0);
  });
});

describe('detector: wash trading', () => {
  it('suppressed below the round-trip floor', () => {
    expect(
      computeWashSignal({ roundTrips: 2, netExposureRatio: 0, reciprocalVolumeUsdc: 1000 }),
    ).toBe(0);
  });
  it('high for many round-trips, ~0 net exposure, real volume', () => {
    const s = computeWashSignal({ roundTrips: 12, netExposureRatio: 0, reciprocalVolumeUsdc: 1000 });
    expect(s).toBeGreaterThan(0.6);
  });
  it('one-sided net exposure is not wash', () => {
    const s = computeWashSignal({ roundTrips: 12, netExposureRatio: 1, reciprocalVolumeUsdc: 1000 });
    expect(s).toBe(0);
  });
});

describe('detector: dispute abuse', () => {
  it('high frivolous + disproportionate disputes → high', () => {
    const s = computeAbuseSignal({
      disputesOpened: 10,
      rejectedDisputes: 9,
      matchedBets: 12,
      patternConcentration: 1,
    });
    expect(s).toBeGreaterThan(0.6);
  });
  it('clean disputer → low', () => {
    const s = computeAbuseSignal({
      disputesOpened: 1,
      rejectedDisputes: 0,
      matchedBets: 50,
      patternConcentration: 0,
    });
    expect(s).toBeLessThan(0.1);
  });
});

describe('detector: velocity', () => {
  it('new account with no baseline → 0 (onboarding is not an anomaly)', () => {
    const s = computeVelocitySignal({
      recentBets: 50,
      baselineBets: 0,
      recentVolumeUsdc: 5000,
      baselineVolumeUsdc: 0,
      recentAvgStakeUsdc: 100,
      baselineAvgStakeUsdc: 0,
      hasBaseline: false,
    });
    expect(s).toBe(0);
  });
  it('10× spike vs baseline → high', () => {
    const s = computeVelocitySignal({
      recentBets: 100,
      baselineBets: 10,
      recentVolumeUsdc: 1000,
      baselineVolumeUsdc: 1000,
      recentAvgStakeUsdc: 10,
      baselineAvgStakeUsdc: 10,
      hasBaseline: true,
    });
    expect(s).toBeCloseTo(1, 5);
  });
});

describe('detector: funding overlap (pure)', () => {
  it('monotonic in shared users, normalised', () => {
    expect(computeFundingOverlapSignal({ sharedSourceUsers: 0 })).toBe(0);
    expect(computeFundingOverlapSignal({ sharedSourceUsers: 5 })).toBeGreaterThan(0.9);
  });
});

describe('detector: sybil (behavioural)', () => {
  it('a lone account is never a sybil cluster', () => {
    expect(
      computeSybilConfidence({
        groupSize: 1,
        creationBurstRatio: 1,
        usernamePatternScore: 1,
        stakeSimilarity: 1,
        templateSimilarity: 1,
      }).confidence,
    ).toBe(0);
  });
  it('burst + name + stake + template similarity → high confidence', () => {
    const r = computeSybilConfidence({
      groupSize: 10,
      creationBurstRatio: 1,
      usernamePatternScore: 1,
      stakeSimilarity: 1,
      templateSimilarity: 1,
    });
    expect(r.confidence).toBeCloseTo(1, 5);
    expect(r.signalsHit).toContain('creation_burst');
  });
});
