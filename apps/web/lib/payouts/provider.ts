import { payouts } from '@rivlayx/core';
import { getEnv } from '@/lib/env';

/**
 * Resolve the Solana transfer provider used by the withdrawal runner.
 *
 *   - production → DevnetSolanaTransferProvider (binds to the configured vault;
 *     throws a permanent error until the on-chain implementation lands — that
 *     hardening is tracked separately, so real mainnet payouts are gated).
 *   - dev / test → MockSolanaTransferProvider (deterministic, idempotent).
 */
export function buildTransferProvider(): payouts.SolanaTransferProvider {
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    return new payouts.DevnetSolanaTransferProvider({
      rpcUrl: env.SOLANA_RPC_URL ?? '',
      usdcMint: '',
    });
  }
  return new payouts.MockSolanaTransferProvider();
}
