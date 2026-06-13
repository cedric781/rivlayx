import { describe, expect, it } from 'vitest';
import { ProviderError } from '../errors';
import { CoinGeckoProvider, parseAssetReference, snapshotFromHistory } from './index';
import { MockCoinGeckoProvider } from './mock';

const pastIso = () => new Date(Date.now() - 60_000).toISOString();
const futureIso = () => new Date(Date.now() + 60_000).toISOString();

describe('parseAssetReference', () => {
  it('extracts asset id from "coingecko:bitcoin"', () => {
    expect(parseAssetReference('coingecko:bitcoin')).toBe('bitcoin');
  });
  it('rejects malformed', () => {
    expect(() => parseAssetReference('coingecko:')).toThrowError(ProviderError);
    expect(() => parseAssetReference('coingeck:btc')).toThrowError(ProviderError);
  });
});

describe('snapshotFromHistory', () => {
  it('extracts price from usd', () => {
    const snap = snapshotFromHistory({
      id: 'bitcoin',
      market_data: { current_price: { usd: 50000 } },
    });
    expect(snap.priceUsd).toBe(50000);
  });
  it('throws when usd missing', () => {
    expect(() =>
      snapshotFromHistory({ id: 'bitcoin', market_data: { current_price: {} } }),
    ).toThrowError(ProviderError);
  });
});

describe('MockCoinGeckoProvider — price_above', () => {
  it('returns yes when current price exceeds threshold and deadline passed', async () => {
    const mock = new MockCoinGeckoProvider();
    mock.setPrice('bitcoin', 100_000);
    const predicate = {
      type: 'price_above' as const,
      asset: 'coingecko:bitcoin',
      threshold: 50_000,
      deadlineAt: pastIso(),
    };
    const raw = await mock.fetchResult({ predicate });
    expect(mock.validateResult(raw)).toEqual({ ok: true });
    const result = mock.normalizeResult(raw, predicate);
    expect(result.status).toBe('final');
    expect(result.winningSide).toBe('yes');
  });

  it('returns no when current price is at or below threshold', async () => {
    const mock = new MockCoinGeckoProvider();
    mock.setPrice('bitcoin', 50_000);
    const predicate = {
      type: 'price_above' as const,
      asset: 'coingecko:bitcoin',
      threshold: 50_000,
      deadlineAt: pastIso(),
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('no');
  });

  it('returns pending when deadline is still in the future', async () => {
    const mock = new MockCoinGeckoProvider();
    mock.setPrice('bitcoin', 100_000);
    const predicate = {
      type: 'price_above' as const,
      asset: 'coingecko:bitcoin',
      threshold: 50_000,
      deadlineAt: futureIso(),
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.status).toBe('pending');
  });
});

describe('MockCoinGeckoProvider — price_below', () => {
  it('returns yes when price is below threshold', async () => {
    const mock = new MockCoinGeckoProvider();
    mock.setPrice('ethereum', 1_000);
    const predicate = {
      type: 'price_below' as const,
      asset: 'coingecko:ethereum',
      threshold: 3_000,
      deadlineAt: pastIso(),
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('yes');
  });

  it('returns no when price is at or above threshold', async () => {
    const mock = new MockCoinGeckoProvider();
    mock.setPrice('ethereum', 4_000);
    const predicate = {
      type: 'price_below' as const,
      asset: 'coingecko:ethereum',
      threshold: 3_000,
      deadlineAt: pastIso(),
    };
    const result = mock.normalizeResult(await mock.fetchResult({ predicate }), predicate);
    expect(result.winningSide).toBe('no');
  });
});

describe('CoinGeckoProvider — supports', () => {
  it('supports only price_above and price_below', () => {
    const p = new CoinGeckoProvider();
    expect(
      p.supports({
        type: 'price_above',
        asset: 'coingecko:btc',
        threshold: 1,
        deadlineAt: pastIso(),
      }),
    ).toBe(true);
    expect(
      p.supports({
        type: 'price_below',
        asset: 'coingecko:btc',
        threshold: 1,
        deadlineAt: pastIso(),
      }),
    ).toBe(true);
    expect(
      p.supports({ type: 'team_wins', team: 'A', eventReference: 'apifootball:fixture:1' }),
    ).toBe(false);
  });
});
