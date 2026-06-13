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
import type { CoinGeckoHistoryResponse, PriceSnapshot } from './types';

const PROVIDER_NAME = 'coingecko';

export interface CoinGeckoConfig {
  /** Optional pro-tier API key. Free tier works without one. */
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Parse our internal `coingecko:bitcoin` style reference into the asset id. */
export function parseAssetReference(reference: string): string {
  const parts = reference.split(':');
  if (parts.length !== 2 || parts[0] !== 'coingecko' || !parts[1]) {
    throw new ProviderError(
      'INVALID_REFERENCE',
      `expected "coingecko:<asset>", got "${reference}"`,
    );
  }
  return parts[1];
}

export function snapshotFromHistory(raw: CoinGeckoHistoryResponse): PriceSnapshot {
  const price = raw.market_data?.current_price?.usd;
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new ProviderError('MALFORMED_RESPONSE', 'CoinGecko response missing usd price');
  }
  return {
    assetId: raw.id,
    priceUsd: price,
    observedAt: new Date().toISOString(),
  };
}

function formatHistoryDate(iso: string): string {
  // CoinGecko expects dd-mm-yyyy.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new ProviderError('INVALID_REFERENCE', `bad deadline ISO: ${iso}`);
  }
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export class CoinGeckoProvider implements ResolveProvider {
  readonly name = PROVIDER_NAME;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CoinGeckoConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.coingecko.com/api/v3';
    this.fetchImpl =
      config.fetchImpl ??
      (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as typeof fetch));
  }

  supports(predicate: SupportedPredicate): boolean {
    return predicate.type === 'price_above' || predicate.type === 'price_below';
  }

  async fetchResult({
    predicate,
  }: {
    predicate: SupportedPredicate;
  }): Promise<RawProviderResponse> {
    if (!this.supports(predicate)) {
      throw new ProviderError('UNSUPPORTED_PREDICATE', `cannot fetch for ${predicate.type}`);
    }
    if (!this.fetchImpl) {
      throw new ProviderError('NO_HTTP_CLIENT', 'global fetch is unavailable');
    }
    const p = predicate as PriceAbovePredicate | PriceBelowPredicate;
    const assetId = parseAssetReference(p.asset);
    const date = formatHistoryDate(p.deadlineAt);
    const url = `${this.baseUrl}/coins/${encodeURIComponent(assetId)}/history?date=${date}`;

    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers['x-cg-pro-api-key'] = this.config.apiKey;

    const res = await this.fetchImpl(url, { headers });
    if (!res.ok) {
      throw new ProviderError(
        'NETWORK_ERROR',
        `CoinGecko history returned ${res.status} ${res.statusText}`,
      );
    }
    const json = (await res.json().catch(() => null)) as CoinGeckoHistoryResponse | null;
    if (!json) {
      throw new ProviderError('MALFORMED_RESPONSE', 'CoinGecko response was not JSON');
    }
    return json as unknown as RawProviderResponse;
  }

  validateResult(raw: RawProviderResponse): ValidationOutcome {
    try {
      snapshotFromHistory(raw as unknown as CoinGeckoHistoryResponse);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: 'malformed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  normalizeResult(raw: RawProviderResponse, predicate: SupportedPredicate): ProviderResult {
    if (predicate.type !== 'price_above' && predicate.type !== 'price_below') {
      throw new ProviderError('UNSUPPORTED_PREDICATE', `cannot normalize ${predicate.type}`);
    }
    const snap = snapshotFromHistory(raw as unknown as CoinGeckoHistoryResponse);
    // Pending if we're not yet past the deadline.
    const deadlineMs = new Date(predicate.deadlineAt).getTime();
    if (Date.now() < deadlineMs) {
      return {
        provider: PROVIDER_NAME,
        status: 'pending',
        winningSide: null,
        resolvedAt: null,
        rawPayload: raw,
        message: 'deadline not yet reached',
      };
    }
    const winningSide =
      predicate.type === 'price_above'
        ? snap.priceUsd > predicate.threshold
          ? 'yes'
          : 'no'
        : snap.priceUsd < predicate.threshold
          ? 'yes'
          : 'no';
    return {
      provider: PROVIDER_NAME,
      status: 'final',
      winningSide,
      resolvedAt: snap.observedAt,
      rawPayload: raw,
    };
  }
}
