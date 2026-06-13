import { ProviderError } from '../errors';
import type {
  PriceAbovePredicate,
  PriceBelowPredicate,
  ProviderResult,
  RawProviderResponse,
  ResolveProvider,
  SupportedPredicate,
  ValidationOutcome,
} from '../types';
import { CoinGeckoProvider, parseAssetReference } from './index';
import type { CoinGeckoHistoryResponse } from './types';

/**
 * Programmable in-memory CoinGecko for tests. Stores historical prices keyed
 * by asset id; delegates parsing + normalization to the real provider so test
 * coverage exercises the production logic.
 */
export class MockCoinGeckoProvider implements ResolveProvider {
  readonly name = 'coingecko';
  private readonly delegate = new CoinGeckoProvider();
  private readonly prices = new Map<string, number>();

  setPrice(assetId: string, priceUsd: number): void {
    this.prices.set(assetId, priceUsd);
  }

  clearAll(): void {
    this.prices.clear();
  }

  supports(predicate: SupportedPredicate): boolean {
    return this.delegate.supports(predicate);
  }

  async fetchResult({
    predicate,
  }: {
    predicate: SupportedPredicate;
  }): Promise<RawProviderResponse> {
    if (!this.supports(predicate)) {
      throw new ProviderError('UNSUPPORTED_PREDICATE', `cannot fetch for ${predicate.type}`);
    }
    const p = predicate as PriceAbovePredicate | PriceBelowPredicate;
    const assetId = parseAssetReference(p.asset);
    const priceUsd = this.prices.get(assetId);
    if (priceUsd === undefined) {
      throw new ProviderError('NOT_FOUND', `mock price for ${assetId} not registered`);
    }
    const payload: CoinGeckoHistoryResponse = {
      id: assetId,
      market_data: { current_price: { usd: priceUsd } },
    };
    return payload as unknown as RawProviderResponse;
  }

  validateResult(raw: RawProviderResponse): ValidationOutcome {
    return this.delegate.validateResult(raw);
  }

  normalizeResult(raw: RawProviderResponse, predicate: SupportedPredicate): ProviderResult {
    return this.delegate.normalizeResult(raw, predicate);
  }
}
