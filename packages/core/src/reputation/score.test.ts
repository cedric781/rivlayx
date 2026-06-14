import { describe, expect, it } from 'vitest';
import { computeArbiterReputation, computeReputation } from './score';
import type { ArbiterSignals, ReputationSignals } from './types';

function arbiterSignals(overrides: Partial<ArbiterSignals> = {}): ArbiterSignals {
  return {
    accepted: 0,
    declined: 0,
    rulings: 0,
    overturned: 0,
    distinctCreators: 0,
    distinctParticipants: 0,
    platformRulings: 0,
    ...overrides,
  };
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

describe('computeArbiterReputation (hardened, Sprint 16.5)', () => {
  const QUALIFIED = {
    accepted: 25,
    declined: 0,
    rulings: 25,
    overturned: 0,
    distinctCreators: 15,
    distinctParticipants: 25,
    platformRulings: 0,
  };

  it('a fully-independent, accurate arbiter reaches trusted', () => {
    const r = computeArbiterReputation(arbiterSignals(QUALIFIED));
    expect(r.arbiterProvisional).toBe(false);
    expect(r.arbiterTier).toBe('trusted');
  });

  it('stays provisional below the independence floor even with many rulings', () => {
    // 50 clean rulings but only 2 distinct creators → still "new".
    const r = computeArbiterReputation(
      arbiterSignals({
        accepted: 50,
        rulings: 50,
        overturned: 0,
        distinctCreators: 2,
        distinctParticipants: 2,
      }),
    );
    expect(r.arbiterProvisional).toBe(true);
    expect(r.arbiterTier).toBe('new');
  });

  it('cannot be trusted with too few distinct creators (15 required)', () => {
    const r = computeArbiterReputation(
      arbiterSignals({ ...QUALIFIED, distinctCreators: 12 }),
    );
    expect(r.arbiterTier).not.toBe('trusted');
  });

  it('cannot be trusted with too few distinct participants (25 required)', () => {
    const r = computeArbiterReputation(
      arbiterSignals({ ...QUALIFIED, distinctParticipants: 18 }),
    );
    expect(r.arbiterTier).not.toBe('trusted');
  });

  it('overturned rate above 2% blocks trusted', () => {
    const r = computeArbiterReputation(arbiterSignals({ ...QUALIFIED, overturned: 1 }));
    expect(r.overturnedRate).toBeCloseTo(0.04, 2);
    expect(r.arbiterTier).not.toBe('trusted');
  });

  it('heavy overturns drop the score well below trusted', () => {
    const r = computeArbiterReputation(
      arbiterSignals({ ...QUALIFIED, overturned: 12 }),
    );
    expect(r.overturnedRate).toBeGreaterThan(0.4);
    expect(r.arbiterTier).not.toBe('trusted');
  });

  it('platform-selected arbiters get a small trust bonus over user-selected', () => {
    const userSelected = computeArbiterReputation(arbiterSignals({ ...QUALIFIED, platformRulings: 0 }));
    const platform = computeArbiterReputation(
      arbiterSignals({ ...QUALIFIED, platformRulings: 25 }),
    );
    expect(platform.arbiterScore).toBeGreaterThan(userSelected.arbiterScore);
  });
});
