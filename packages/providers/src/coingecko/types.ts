export interface CoinGeckoHistoryResponse {
  id: string;
  market_data?: {
    current_price?: { usd?: number };
  };
}

export interface PriceSnapshot {
  assetId: string;
  priceUsd: number;
  observedAt: string;
}
