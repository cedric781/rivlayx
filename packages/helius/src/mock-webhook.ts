import { randomBytes } from 'node:crypto';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { computeHeliusSignature } from './verify';
import type { TokenTransferEvent } from './types';

export interface MockTokenTransferOptions {
  sourceWallet: string;
  destAta: string;
  amountUsdc: number;
  destWallet?: string;
  sourceAta?: string;
  mint?: string;
  signature?: string;
  slot?: number;
  timestamp?: number;
}

export interface SignedEnvelope {
  rawBody: string;
  signature: string;
}

/**
 * Build a synthetic TOKEN_TRANSFER event for tests. Sane defaults for slot,
 * timestamp, signature; required fields surface intent (source, dest, amount).
 */
export function buildMockTokenTransfer(opts: MockTokenTransferOptions): TokenTransferEvent {
  const signature = opts.signature ?? randomBytes(40).toString('hex');
  return {
    type: 'TOKEN_TRANSFER',
    signature,
    slot: opts.slot ?? Math.floor(Math.random() * 1_000_000) + 100_000,
    timestamp: opts.timestamp ?? Math.floor(Date.now() / 1000),
    tokenTransfers: [
      {
        fromUserAccount: opts.sourceWallet,
        toUserAccount: opts.destWallet ?? 'VaultOwner11111111111111111111111111111111',
        fromTokenAccount: opts.sourceAta ?? 'SourceATA111111111111111111111111111111111',
        toTokenAccount: opts.destAta,
        tokenAmount: opts.amountUsdc,
        mint: opts.mint ?? USDC_MINT_ADDRESS,
        tokenStandard: 'Fungible',
      },
    ],
  };
}

/**
 * Serialise an event batch and HMAC-sign it as Helius would.
 * Returns the raw body + hex signature for use in webhook handler tests.
 */
export function buildSignedEnvelope(events: TokenTransferEvent[], secret: string): SignedEnvelope {
  const rawBody = JSON.stringify(events);
  const signature = computeHeliusSignature(secret, rawBody);
  return { rawBody, signature };
}
