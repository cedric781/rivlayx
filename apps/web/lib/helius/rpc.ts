import { RealHeliusRpc, type IHeliusRpc } from '@rivlayx/helius';
import { getEnv } from '@/lib/env';

/**
 * Single construction point for the live Solana RPC client used by the deposit
 * poller (`/api/cron/deposits`) and on-chain reconciliation (`/api/cron/recon`).
 *
 * C6B/C: the old `WebhookFinalityRpc` (which faked `finalized`) is gone. Deposit
 * finality is now verified independently via `RealHeliusRpc.getSignatureStatus`,
 * and credit happens only through the poller — never from webhook delivery.
 *
 * Returns `null` when `SOLANA_RPC_URL` is unset (dev/test), so callers can skip
 * gracefully instead of crediting on a fabricated status. `SOLANA_RPC_URL` is
 * required in production (see `apps/web/lib/env.ts`).
 */
export function buildHeliusRpc(): IHeliusRpc | null {
  const env = getEnv();
  if (!env.SOLANA_RPC_URL) return null;
  return new RealHeliusRpc(env.SOLANA_RPC_URL);
}
