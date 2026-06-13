import Decimal from 'decimal.js';
import { USDC_DECIMALS } from '@rivlayx/shared';
import type { TokenTransferEvent } from './types';

export type ParseErrorCode =
  | 'NO_USDC_TRANSFER'
  | 'WRONG_MINT'
  | 'WRONG_DESTINATION'
  | 'MALFORMED_AMOUNT';

export class ParseError extends Error {
  public readonly code: ParseErrorCode;
  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ParseError';
  }
}

export interface ParsedTransfer {
  signature: string;
  slot: number;
  timestamp: number;
  sourceWallet: string;
  destWallet: string;
  sourceAta: string | null;
  destAta: string | null;
  /** Canonical USDC amount as a decimal string with USDC_DECIMALS precision. */
  amountUsdc: string;
  mint: string;
}

export interface ParseOptions {
  /** USDC mint address — events whose USDC leg is to another mint are rejected. */
  expectedMint: string;
  /** Vault ATA — events whose USDC leg is to another destination are rejected. */
  expectedDestAta: string;
}

/**
 * Extract the canonical incoming-USDC transfer from a Helius event, validating
 * mint + destination. Throws `ParseError` with a code on any structural issue.
 * Pure function — no DB, no network.
 */
export function parseSplTransfer(event: TokenTransferEvent, options: ParseOptions): ParsedTransfer {
  // Find the first transfer where mint matches and destination is the vault.
  const candidate = event.tokenTransfers.find(
    (t) => t.mint === options.expectedMint && t.toTokenAccount === options.expectedDestAta,
  );

  if (!candidate) {
    // Did the event have any USDC leg at all?
    const usdcLeg = event.tokenTransfers.find((t) => t.mint === options.expectedMint);
    if (usdcLeg) {
      throw new ParseError(
        'WRONG_DESTINATION',
        `USDC transfer present but destination ${usdcLeg.toTokenAccount ?? 'null'} != expected ${options.expectedDestAta}`,
      );
    }
    const anyLeg = event.tokenTransfers[0];
    throw new ParseError(
      anyLeg ? 'WRONG_MINT' : 'NO_USDC_TRANSFER',
      anyLeg
        ? `Expected mint ${options.expectedMint}, got ${anyLeg.mint}`
        : 'Event has no token transfers',
    );
  }

  let amountUsdc: string;
  try {
    const d = new Decimal(candidate.tokenAmount);
    if (!d.isFinite() || d.lt(0)) {
      throw new Error('amount not finite or negative');
    }
    amountUsdc = d.toFixed(USDC_DECIMALS);
  } catch (err) {
    throw new ParseError(
      'MALFORMED_AMOUNT',
      `Unable to parse tokenAmount=${String(candidate.tokenAmount)}: ${(err as Error).message}`,
    );
  }

  return {
    signature: event.signature,
    slot: event.slot,
    timestamp: event.timestamp,
    sourceWallet: candidate.fromUserAccount,
    destWallet: candidate.toUserAccount,
    sourceAta: candidate.fromTokenAccount,
    destAta: candidate.toTokenAccount,
    amountUsdc,
    mint: candidate.mint,
  };
}
