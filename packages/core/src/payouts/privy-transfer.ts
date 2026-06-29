import { PublicKey, Transaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { USDC_DECIMALS, toRawUnits } from '@rivlayx/shared';
import { TransferPermanentError, TransferRetryableError } from './errors';
import type { SolanaTransferProvider, TransferInput, TransferResult } from './types';
import { assertTransferAllowed, PolicyViolationError, type PrivyTransferPolicy } from './privy-policy';
import type { PrivySolanaSigner, SolanaCaip2 } from './privy-signer-port';

export interface PrivyTransferProviderConfig {
  /** Delegated signer port (real adapter in apps/web; mock in tests). */
  signer: PrivySolanaSigner;
  /** Allow/deny policy enforced before signing. */
  policy: PrivyTransferPolicy;
  /** Target Solana cluster. */
  caip2: SolanaCaip2;
  /** Relayer pubkey (base58) set as fee payer — pays SOL, never the authority. */
  feePayer: string;
}

/**
 * Privy delegated-signing transfer provider (Phase 2). Implements the same
 * `SolanaTransferProvider` contract as the raw-vault/mock providers, so it
 * remains swappable via `buildTransferProvider`.
 *
 * NOT WIRED to any money flow in Phase 2 — built + tested in isolation only.
 *
 * Flow: validate `fromWallet` → policy guard (pre-sign) → build the USDC
 * `transferChecked` (relayer as fee payer; blockhash finalized by Privy at
 * submit) → delegated sign+send with `idempotencyKey = reference` → map errors.
 * Idempotent on `reference`: a replay returns the same signature, never a
 * double-spend.
 */
export class PrivySolanaTransferProvider implements SolanaTransferProvider {
  readonly name = 'privy';

  constructor(private readonly config: PrivyTransferProviderConfig) {}

  async buildAndSubmitTransfer(input: TransferInput): Promise<TransferResult> {
    const fromWallet = input.fromWallet;
    if (!fromWallet) {
      throw new TransferPermanentError('PrivySolanaTransferProvider requires input.fromWallet');
    }

    const { usdcMint } = this.config.policy;

    // ── 1. Policy guard (defense-in-depth; runs BEFORE the signer) ──
    try {
      assertTransferAllowed(
        { fromWallet, toWallet: input.toWallet, amountUsdc: input.amountUsdc, mint: usdcMint },
        this.config.policy,
      );
    } catch (err) {
      // Policy denial is permanent — retrying cannot make it allowed.
      throw new TransferPermanentError(
        err instanceof PolicyViolationError ? err.message : String(err),
      );
    }

    // ── 2. Build the unsigned USDC transfer (pure; no RPC) ──
    let transaction: Transaction;
    try {
      transaction = buildUsdcTransferTransaction({
        fromWallet,
        toWallet: input.toWallet,
        amountUsdc: input.amountUsdc,
        mint: usdcMint,
        feePayer: this.config.feePayer,
      });
    } catch (err) {
      // Malformed address / amount → permanent (a retry cannot fix the input).
      throw new TransferPermanentError(
        `failed to build transfer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── 3. Delegated sign + send (idempotent on reference) ──
    try {
      const { txSignature } = await this.config.signer.signAndSend({
        fromWallet,
        caip2: this.config.caip2,
        idempotencyKey: input.reference,
        transaction,
      });
      return { txSignature };
    } catch (err) {
      // Preserve an explicit classification; default unknown signer errors to
      // retryable (the idempotency key makes a retry safe).
      if (err instanceof TransferRetryableError || err instanceof TransferPermanentError) throw err;
      throw new TransferRetryableError(err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Build an unsigned single-instruction USDC `transferChecked` transaction.
 * Pure — derives ATAs and assembles the instruction with no network calls. The
 * recent blockhash is set at submission time (Privy finalizes it for
 * `signAndSendTransaction`); the relayer is the fee payer.
 */
export function buildUsdcTransferTransaction(args: {
  fromWallet: string;
  toWallet: string;
  amountUsdc: string;
  mint: string;
  feePayer: string;
}): Transaction {
  const fromOwner = new PublicKey(args.fromWallet);
  const toOwner = new PublicKey(args.toWallet);
  const mint = new PublicKey(args.mint);
  const feePayer = new PublicKey(args.feePayer);

  // allowOwnerOffCurve=true so escrow/PDA-style owners are supported.
  const fromAta = getAssociatedTokenAddressSync(mint, fromOwner, true);
  const toAta = getAssociatedTokenAddressSync(mint, toOwner, true);
  const rawAmount = toRawUnits(args.amountUsdc);

  const ix = createTransferCheckedInstruction(
    fromAta,
    mint,
    toAta,
    fromOwner,
    rawAmount,
    USDC_DECIMALS,
  );

  const tx = new Transaction().add(ix);
  tx.feePayer = feePayer;
  return tx;
}
