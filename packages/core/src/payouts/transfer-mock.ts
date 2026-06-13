import { randomUUID } from 'node:crypto';
import { TransferPermanentError, TransferRetryableError } from './errors';
import type { SolanaTransferProvider, TransferInput, TransferResult } from './types';

type ProgrammedFailure =
  | { kind: 'retryable'; message: string; remainingHits: number }
  | { kind: 'permanent'; message: string };

/**
 * Programmable in-memory transfer provider. Tests configure outcomes via
 * `setRetryableFailure(reference, n)` / `setPermanentFailure(reference)` /
 * default success. Re-submission of the same reference returns the original
 * signature — the production contract requires this.
 */
export class MockSolanaTransferProvider implements SolanaTransferProvider {
  readonly name = 'mock_solana';
  private readonly signatures = new Map<string, string>();
  private readonly failures = new Map<string, ProgrammedFailure>();

  /** Programmed `n` consecutive retryable failures for this reference. */
  setRetryableFailure(reference: string, count = 1, message = 'transient RPC error'): void {
    this.failures.set(reference, { kind: 'retryable', message, remainingHits: count });
  }

  setPermanentFailure(reference: string, message = 'invalid destination'): void {
    this.failures.set(reference, { kind: 'permanent', message });
  }

  clearAll(): void {
    this.signatures.clear();
    this.failures.clear();
  }

  async buildAndSubmitTransfer(input: TransferInput): Promise<TransferResult> {
    // Idempotent replay
    const existing = this.signatures.get(input.reference);
    if (existing) return { txSignature: existing };

    const failure = this.failures.get(input.reference);
    if (failure) {
      if (failure.kind === 'permanent') {
        throw new TransferPermanentError(failure.message);
      }
      // retryable
      failure.remainingHits -= 1;
      if (failure.remainingHits <= 0) this.failures.delete(input.reference);
      throw new TransferRetryableError(failure.message);
    }

    const txSignature = `mocksig_${randomUUID().replace(/-/g, '').slice(0, 40)}`;
    this.signatures.set(input.reference, txSignature);
    return { txSignature };
  }
}
