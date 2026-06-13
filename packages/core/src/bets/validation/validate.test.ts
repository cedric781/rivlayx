import { describe, expect, it } from 'vitest';
import { BetError } from '../errors';
import { validateObjectiveBet } from './validate';

const futureIso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

describe('validateObjectiveBet — happy paths', () => {
  it('accepts a team_wins bet', () => {
    const result = validateObjectiveBet({
      title: 'Ajax wins from PSV',
      description: 'Eredivisie matchday 32',
      predicate: {
        type: 'team_wins',
        team: 'Ajax',
        eventReference: 'apifootball:fixture:12345',
      },
    });
    expect(result.predicate.type).toBe('team_wins');
    expect(result.display).toContain('Ajax wins');
  });

  it('accepts a price_above bet', () => {
    const result = validateObjectiveBet({
      title: 'BTC above 200k by year-end',
      predicate: {
        type: 'price_above',
        asset: 'coingecko:bitcoin',
        threshold: 200000,
        deadlineAt: futureIso(86_400_000 * 30),
      },
    });
    expect(result.display).toContain('200000');
  });

  it('accepts distance_completed (evidence-resolve flavour)', () => {
    const result = validateObjectiveBet({
      title: 'Alice runs 10km before Sunday',
      predicate: {
        type: 'distance_completed',
        distanceKm: 10,
        deadlineAt: futureIso(86_400_000 * 3),
        subject: 'Alice',
      },
    });
    expect(result.predicate.type).toBe('distance_completed');
  });
});

describe('validateObjectiveBet — subjective rejection', () => {
  it('rejects "Wie is beter?" even with a valid predicate attached', () => {
    expect(() =>
      validateObjectiveBet({
        title: 'Wie is beter, Ajax of PSV?',
        predicate: {
          type: 'team_wins',
          team: 'Ajax',
          eventReference: 'apifootball:fixture:1',
        },
      }),
    ).toThrowError(BetError);
  });

  it('rejects subjective phrasing in description', () => {
    try {
      validateObjectiveBet({
        title: 'Match outcome',
        description: 'who is prettier?',
        predicate: {
          type: 'team_wins',
          team: 'Ajax',
          eventReference: 'apifootball:fixture:1',
        },
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BetError);
      expect((err as BetError).code).toBe('SUBJECTIVE_LANGUAGE');
    }
  });
});

describe('validateObjectiveBet — predicate validation', () => {
  it('rejects unknown predicate type', () => {
    expect(() =>
      validateObjectiveBet({
        title: 'BTC moonshot',
        predicate: { type: 'mood_vibes', value: 'bullish' },
      }),
    ).toThrowError(/UNKNOWN_PREDICATE|not a supported/);
  });

  it('rejects malformed team_wins (missing eventReference)', () => {
    expect(() =>
      validateObjectiveBet({
        title: 'Ajax wins',
        predicate: { type: 'team_wins', team: 'Ajax' },
      }),
    ).toThrowError(BetError);
  });

  it('rejects price_above with negative threshold', () => {
    expect(() =>
      validateObjectiveBet({
        title: 'BTC above',
        predicate: {
          type: 'price_above',
          asset: 'coingecko:bitcoin',
          threshold: -1,
          deadlineAt: futureIso(86_400_000),
        },
      }),
    ).toThrowError(BetError);
  });

  it('rejects when template-bound predicate kind disagrees', () => {
    try {
      validateObjectiveBet({
        title: 'Football match winner',
        predicate: {
          type: 'price_above',
          asset: 'coingecko:bitcoin',
          threshold: 1,
          deadlineAt: futureIso(86_400_000),
        },
        expectedPredicateKind: 'team_wins',
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BetError);
      expect((err as BetError).code).toBe('TEMPLATE_PREDICATE_MISMATCH');
    }
  });
});

describe('validateObjectiveBet — input bounds', () => {
  it('rejects empty title', () => {
    expect(() =>
      validateObjectiveBet({
        title: '',
        predicate: {
          type: 'team_wins',
          team: 'Ajax',
          eventReference: 'apifootball:fixture:1',
        },
      }),
    ).toThrowError(/title/);
  });

  it('rejects oversized description', () => {
    expect(() =>
      validateObjectiveBet({
        title: 'Ajax wins',
        description: 'a'.repeat(2001),
        predicate: {
          type: 'team_wins',
          team: 'Ajax',
          eventReference: 'apifootball:fixture:1',
        },
      }),
    ).toThrowError(/description/);
  });
});
