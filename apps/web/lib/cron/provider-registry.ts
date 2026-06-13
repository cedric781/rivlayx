import { ProviderRegistry, ApiFootballProvider, CoinGeckoProvider } from '@rivlayx/providers';
import { getEnv } from '@/lib/env';

/**
 * Build the auto-resolve provider registry from env. Live providers read their
 * API keys from env; registration order is precedence. No new provider logic —
 * pure wiring for the auto-resolve cron.
 */
export function buildProviderRegistry(): ProviderRegistry {
  const env = getEnv();
  const registry = new ProviderRegistry();
  registry.register(new ApiFootballProvider({ apiKey: env.API_FOOTBALL_KEY }));
  registry.register(new CoinGeckoProvider({ apiKey: env.COINGECKO_API_KEY }));
  return registry;
}
