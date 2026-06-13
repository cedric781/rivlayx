import { describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import { ProviderRegistry } from './registry';
import { MockApiFootballProvider } from './api-football/mock';
import { MockCoinGeckoProvider } from './coingecko/mock';

describe('ProviderRegistry', () => {
  it('returns the first provider that supports the predicate', () => {
    const reg = new ProviderRegistry();
    const apiFootball = new MockApiFootballProvider();
    const coingecko = new MockCoinGeckoProvider();
    reg.register(apiFootball);
    reg.register(coingecko);

    expect(
      reg.getFor({
        type: 'team_wins',
        team: 'Ajax',
        eventReference: 'apifootball:fixture:1',
      }).name,
    ).toBe('api_football');

    expect(
      reg.getFor({
        type: 'price_above',
        asset: 'coingecko:bitcoin',
        threshold: 100000,
        deadlineAt: '2030-01-01T00:00:00Z',
      }).name,
    ).toBe('coingecko');
  });

  it('throws when no provider supports the predicate', () => {
    const reg = new ProviderRegistry();
    expect(() =>
      reg.getFor({
        type: 'team_wins',
        team: 'Ajax',
        eventReference: 'apifootball:fixture:1',
      }),
    ).toThrowError(ProviderError);
  });
});
