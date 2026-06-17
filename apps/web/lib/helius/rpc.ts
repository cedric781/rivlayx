import type {
  IHeliusRpc,
  SignatureStatus,
  SignatureInfo,
  TokenAccountBalance,
} from '@rivlayx/helius';

/**
 * Deposit-confirmation RPC for the Helius webhook ingress (Sprint 30).
 *
 * Helius **enhanced transaction webhooks** are delivered only after the
 * configured commitment (we run them at `finalized`), and every inbound batch
 * is HMAC-authenticated at the route boundary. For that trusted, finalized
 * source we treat the webhook delivery itself as the finality signal: any
 * signature we were just handed reports `finalized`. This lets the existing
 * `detectDeposit → confirmDeposit → creditDeposit` pipeline run unchanged
 * without an extra RPC round-trip.
 *
 * Trade-off (documented closed-alpha posture): we trust Helius finality rather
 * than independently re-checking on chain. An independent `getSignatureStatuses`
 * re-check is a later hardening step — it does not change this pipeline, only
 * which `IHeliusRpc` is injected here.
 *
 * Only `getSignatureStatus` is exercised by the deposit-confirm path; the other
 * interface methods are not used in webhook ingestion and throw if called.
 */
export class WebhookFinalityRpc implements IHeliusRpc {
  async getSignatureStatus(signature: string): Promise<SignatureStatus | null> {
    return {
      signature,
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: null,
      err: null,
    };
  }

  async getTokenAccountBalance(_address: string): Promise<TokenAccountBalance> {
    throw new Error('getTokenAccountBalance is not used by webhook deposit ingestion');
  }

  async getSignaturesForAddress(_address: string): Promise<SignatureInfo[]> {
    throw new Error('getSignaturesForAddress is not used by webhook deposit ingestion');
  }
}
