export {
  type PredicateKind,
  type PredicateBase,
  type TeamWinsPredicate,
  type ScoreOverUnderPredicate,
  type PriceAbovePredicate,
  type PriceBelowPredicate,
  type SupportedPredicate,
  type RawProviderResponse,
  type ValidationOutcome,
  type ProviderResult,
  type FetchResultInput,
  type ResolveProvider,
} from './types';
export { ProviderError, type ProviderErrorCode } from './errors';
export { ProviderRegistry } from './registry';
export {
  ApiFootballProvider,
  parseFixtureReference,
  snapshotFromEnvelope,
  type ApiFootballConfig,
} from './api-football';
export { MockApiFootballProvider } from './api-football/mock';
export type { FixtureSnapshot, ApiFootballEnvelope } from './api-football/types';
export {
  CoinGeckoProvider,
  parseAssetReference,
  snapshotFromHistory,
  type CoinGeckoConfig,
} from './coingecko';
export { MockCoinGeckoProvider } from './coingecko/mock';
export type { PriceSnapshot, CoinGeckoHistoryResponse } from './coingecko/types';
