import { describe, expect, it } from 'vitest';
import { ProviderError } from '../errors';
import { ApiFootballProvider, parseFixtureReference, snapshotFromEnvelope } from './index';
import { MockApiFootballProvider } from './mock';
import type { ApiFootballEnvelope } from './types';

describe('parseFixtureReference', () => {
  it('extracts fixture id from a well-formed reference', () => {
    expect(parseFixtureReference('apifootball:fixture:12345')).toBe('12345');
  });

  it('rejects malformed references', () => {
    expect(() => parseFixtureReference('foo:bar:1')).toThrowError(ProviderError);
    expect(() => parseFixtureReference('apifootball:fixture:')).toThrowError(ProviderError);
    expect(() => parseFixtureReference('not-a-reference')).toThrowError(ProviderError);
  });
});

describe('snapshotFromEnvelope', () => {
  it('parses a normal envelope', () => {
    const env: ApiFootballEnvelope = {
      response: [
        {
          fixture: { id: 42, status: { short: 'FT', long: 'Match Finished' } },
          teams: { home: { name: 'Ajax' }, away: { name: 'PSV' } },
          goals: { home: 2, away: 1 },
        },
      ],
    };
    const snap = snapshotFromEnvelope(env);
    expect(snap.fixtureId).toBe('42');
    expect(snap.statusShort).toBe('FT');
    expect(snap.homeGoals).toBe(2);
    expect(snap.awayGoals).toBe(1);
  });

  it('treats null goals as 0', () => {
    const env: ApiFootballEnvelope = {
      response: [
        {
          fixture: { id: 1, status: { short: 'NS', long: 'Not Started' } },
          teams: { home: { name: 'A' }, away: { name: 'B' } },
          goals: { home: null, away: null },
        },
      ],
    };
    expect(snapshotFromEnvelope(env).homeGoals).toBe(0);
  });

  it('throws when response array is empty', () => {
    expect(() => snapshotFromEnvelope({ response: [] })).toThrowError(ProviderError);
  });
});

describe('MockApiFootballProvider — team_wins', () => {
  it('returns winningSide=home when home wins', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '42',
      statusShort: 'FT',
      homeName: 'Ajax',
      awayName: 'PSV',
      homeGoals: 2,
      awayGoals: 1,
    });
    const predicate = {
      type: 'team_wins' as const,
      team: 'Ajax',
      eventReference: 'apifootball:fixture:42',
    };
    const raw = await mock.fetchResult({ predicate });
    expect(mock.validateResult(raw)).toEqual({ ok: true });
    const result = mock.normalizeResult(raw, predicate);
    expect(result.status).toBe('final');
    expect(result.winningSide).toBe('home');
  });

  it('returns winningSide=away when away wins', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '7',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 0,
      awayGoals: 3,
    });
    const predicate = {
      type: 'team_wins' as const,
      team: 'B',
      eventReference: 'apifootball:fixture:7',
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('away');
  });

  it('returns winningSide=draw on equal score', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '3',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 1,
    });
    const predicate = {
      type: 'team_wins' as const,
      team: 'A',
      eventReference: 'apifootball:fixture:3',
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('draw');
  });

  it('returns status=pending when fixture is not yet finished', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '5',
      statusShort: '1H',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });
    const predicate = {
      type: 'team_wins' as const,
      team: 'A',
      eventReference: 'apifootball:fixture:5',
    };
    const raw = await mock.fetchResult({ predicate });
    expect(mock.validateResult(raw)).toMatchObject({ ok: false, reason: 'pending' });
    expect(mock.normalizeResult(raw, predicate).status).toBe('pending');
  });

  it('returns status=cancelled when fixture is abandoned', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '9',
      statusShort: 'CANC',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 0,
      awayGoals: 0,
    });
    const predicate = {
      type: 'team_wins' as const,
      team: 'A',
      eventReference: 'apifootball:fixture:9',
    };
    const raw = await mock.fetchResult({ predicate });
    expect(mock.validateResult(raw)).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(mock.normalizeResult(raw, predicate).status).toBe('cancelled');
  });
});

describe('MockApiFootballProvider — score_over_under', () => {
  it('returns over when total goals exceed threshold', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '11',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 2,
      awayGoals: 2,
    });
    const predicate = {
      type: 'score_over_under' as const,
      eventReference: 'apifootball:fixture:11',
      threshold: 2.5,
      side: 'over' as const,
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('over');
  });

  it('returns under when total goals are below threshold', async () => {
    const mock = new MockApiFootballProvider();
    mock.setFixture({
      fixtureId: '12',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 0,
      awayGoals: 1,
    });
    const predicate = {
      type: 'score_over_under' as const,
      eventReference: 'apifootball:fixture:12',
      threshold: 2.5,
      side: 'under' as const,
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('under');
  });
});

describe('ApiFootballProvider — supports', () => {
  it('supports only team_wins and score_over_under', () => {
    const p = new ApiFootballProvider();
    expect(p.supports({ type: 'team_wins', team: 'A', eventReference: 'x:y:1' })).toBe(true);
    expect(
      p.supports({
        type: 'score_over_under',
        eventReference: 'x:y:1',
        threshold: 1,
        side: 'over',
      }),
    ).toBe(true);
    expect(
      p.supports({
        type: 'price_above',
        asset: 'coingecko:btc',
        threshold: 1,
        deadlineAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});
