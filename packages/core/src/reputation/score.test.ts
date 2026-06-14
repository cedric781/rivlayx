import { describe, expect, it } from 'vitest';
import { computeArbiterReputation, computeReputation } from './score';
import type { ArbiterSignals, ReputationSignals } from './types';

function arbiterSignals(overrides: Partial<ArbiterSignals> = {}): ArbiterSignals {
  return { accepted: 0, declined: 0, rulings: 0, overturned: 0, ...overrides };
}

function signals(overrides: Partial<ReputationSignals> = {}): ReputationSignals {
  return {
    distinctCounterparties: 0,
    completedBets: 0,
    matchedBets: 0,
    cappedSettledVolumeUsdc: '0',
    ageDays: 0,
    wins: 0,
    losses: 0,
    frivolousDisputes: 0,
    adverseDisputes: 0,
    status: 'active',
    ...overrides,
  };
}

const HONEST = signals({
  distinctCounterparties: 20,
  completedBets: 30,
  matchedBets: 30,
  cappedSettledVolumeUsdc: '1500',
  ageDays: 200,
  wins: 15,
  losses: 15,
});

describe('computeReputation — composition', () => {
  it('scores an established honest user as trusted', () => {
    const r = computeReputation(HONEST);
    expect(r.provisional).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.tier).toBe('trusted');
  });

  it('flags new/low-data active accounts as provisional ("new")', () => {
    const r = computeReputation(
      signals({ distinctCounterparties: 1, completedBets: 1, matchedBets: 1, ageDays: 1 }),
    );
    expect(r.provisional).toBe(true);
    expect(r.tier).toBe('new');
  });
});

describe('computeReputation — fraud resistance', () => {
  it('a wash-trading loop (1 counterparty) scores far below an honest user', () => {
    const wash = computeReputation(
      signals({
        distinctCounterparties: 1,
        completedBets: 100,
        matchedBets: 100,
        // 100 bets with the SAME counterparty → volume capped at 100.
        cappedSettledVolumeUsdc: '100',
        ageDays: 2,
        wins: 50,
        losses: 50,
      }),
    );
    const honest = computeReputation(HONEST);
    expect(wash.score).toBeLessThan(honest.score - 30);
    expect(wash.tier).not.toBe('trusted');
  });

  it('adverse dispute rulings collapse the score via the integrity gate', () => {
    const r = computeReputation(
      signals({
        distinctCounterparties: 20,
        completedBets: 30,
        matchedBets: 10,
        cappedSettledVolumeUsdc: '1500',
        ageDays: 200,
        wins: 5,
        losses: 5,
        adverseDisputes: 5,
      }),
    );
    expect(r.score).toBeLessThan(20);
    expect(r.tier).toBe('untrusted');
  });
});

describe('computeReputation — status modifier', () => {
  it('banned → score 0, not provisional', () => {
    const r = computeReputation({ ...HONEST, status: 'banned' });
    expect(r.score).toBe(0);
    expect(r.provisional).toBe(false);
  });

  it('suspended → capped at 30', () => {
    const r = computeReputation({ ...HONEST, status: 'suspended' });
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.provisional).toBe(false);
  });
});

describe('computeReputation — win-rate', () => {
  it('cannot move the score by more than ~5 points across the full win-rate range', () => {
    const base = {
      distinctCounterparties: 10,
      completedBets: 20,
      matchedBets: 20,
      cappedSettledVolumeUsdc: '500',
      ageDays: 100,
    };
    const allLosses = computeReputation(signals({ ...base, wins: 0, losses: 20 }));
    const allWins = computeReputation(signals({ ...base, wins: 20, losses: 0 }));
    expect(Math.abs(allWins.score - allLosses.score)).toBeLessThanOrEqual(6);
  });

  it('sets winRateAnomaly on extreme rates over a meaningful sample (no score change)', () => {
    const r = computeReputation(
      signals({
        distinctCounterparties: 10,
        completedBets: 20,
        matchedBets: 20,
        ageDays: 100,
        wins: 20,
        losses: 0,
      }),
    );
    expect(r.components.winRateAnomaly).toBe(true);
    const noAnomaly = computeReputation(
      signals({
        distinctCounterparties: 10,
        completedBets: 20,
        matchedBets: 20,
        ageDays: 100,
        wins: 10,
        losses: 10,
      }),
    );
    expect(noAnomaly.components.winRateAnomaly).toBe(false);
  });
});

describe('computeArbiterReputation', () => {
  it('scores an accurate, accepting, experienced arbiter as trusted', () => {
    const r = computeArbiterReputation(
      arbiterSignals({ accepted: 10, declined: 0, rulings: 10, overturned: 0 }),
    );
    expect(r.arbiterProvisional).toBe(false);
    expect(r.arbiterTier).toBe('trusted');
    expect(r.acceptanceRate).toBe(1);
    expect(r.overturnedRate).toBe(0);
  });

  it('marks an arbiter with too few rulings as provisional ("new")', () => {
    const r = computeArbiterReputation(arbiterSignals({ accepted: 2, rulings: 2 }));
    expect(r.arbiterProvisional).toBe(true);
    expect(r.arbiterTier).toBe('new');
  });

  it('overturned rate is the dominant factor — heavy overturns can never be trusted', () => {
    const r = computeArbiterReputation(
      arbiterSignals({ accepted: 20, declined: 0, rulings: 20, overturned: 10 }),
    );
    expect(r.overturnedRate).toBe(0.5);
    expect(r.arbiterTier).not.toBe('trusted');
  });

  it('hard rule: overturnedRate > 5% caps the tier below trusted even with a high score', () => {
    // 50 rulings, only 3 overturned (6%) — would otherwise score into trusted.
    const r = computeArbiterReputation(
      arbiterSignals({ accepted: 50, declined: 0, rulings: 50, overturned: 3 }),
    );
    expect(r.overturnedRate).toBeCloseTo(0.06, 2);
    expect(r.arbiterTier).not.toBe('trusted');
    expect(r.arbiterScore).toBeLessThanOrEqual(79);
  });

  it('acceptance rate ranks below overturned but above experience', () => {
    const lowAcceptance = computeArbiterReputation(
      arbiterSignals({ accepted: 5, declined: 15, rulings: 5, overturned: 0 }),
    );
    const highAcceptance = computeArbiterReputation(
      arbiterSignals({ accepted: 20, declined: 0, rulings: 5, overturned: 0 }),
    );
    expect(highAcceptance.arbiterScore).toBeGreaterThan(lowAcceptance.arbiterScore);
  });
});
