// ─────────────────────────────────────────────────────────────────────────────
// FROZEN UNTIL PRIVY CUTOVER — raw-vault signer selector.
// `buildTransferProvider` is the single place that picks a signer. Do NOT add a
// second signer path here or run raw-vault and Privy side by side. The Privy
// migration REPLACES the body of this one function; until then this raw-vault
// path stays as the only signer (see payment-cleanup-before-zentrix audit).
// ─────────────────────────────────────────────────────────────────────────────
import { payouts } from '@rivlayx/core';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { getEnv } from '@/lib/env';

/**
 * Resolve the Solana transfer provider used by the withdrawal + payout runners.
 *
 *   - dev / test → MockSolanaTransferProvider (deterministic, idempotent).
 *   - production + devnet → real DevnetSolanaTransferProvider (signs with the
 *     configured vault key; submits a real USDC SPL transfer on devnet).
 *   - production + mainnet-beta → kept GATED: returned provider fails every
 *     payout permanently. Mainnet requires signer hardening (KMS/HSM), which is
 *     a separate track and intentionally out of scope here.
 */
export function buildTransferProvider(): payouts.SolanaTransferProvider {
  const env = getEnv();

  if (env.NODE_ENV !== 'production') {
    return new payouts.MockSolanaTransferProvider();
  }

  if (env.SOLANA_NETWORK === 'mainnet-beta') {
    // No signer plumbed for mainnet → any attempt fails permanently (not_configured).
    return new payouts.DevnetSolanaTransferProvider({ rpcUrl: '', usdcMint: '' });
  }

  return new payouts.DevnetSolanaTransferProvider({
    rpcUrl: env.SOLANA_RPC_URL ?? '',
    vaultSecretKeyBase58: env.SOLANA_VAULT_SECRET_KEY,
    usdcMint: env.SOLANA_USDC_MINT ?? USDC_MINT_ADDRESS,
    commitment: 'confirmed',
  });
}
