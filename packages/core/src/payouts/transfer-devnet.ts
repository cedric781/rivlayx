import bs58 from 'bs58';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  type Commitment,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { USDC_DECIMALS, toRawUnits } from '@rivlayx/shared';
import { TransferPermanentError, TransferRetryableError } from './errors';
import type { SolanaTransferProvider, TransferInput, TransferResult } from './types';

export interface DevnetConfig {
  /** Solana RPC URL (devnet). */
  rpcUrl: string;
  /**
   * Base58-encoded 64-byte vault secret key (devnet only). Used to sign the
   * USDC transfer. NEVER logged, never surfaced in an error message.
   */
  vaultSecretKeyBase58?: string;
  /** USDC SPL mint address for this network (devnet mint differs from mainnet). */
  usdcMint: string;
  /** Confirmation commitment. Defaults to 'confirmed'. */
  commitment?: Commitment;
}

/**
 * Substrings that mark a network/RPC error as transient (safe to retry — the
 * transaction was provably never accepted by the cluster).
 */
const RETRYABLE_HINTS = [
  'timeout',
  'timed out',
  'blockhash not found',
  'node is behind',
  'rate limit',
  'too many requests',
  '429',
  '503',
  '502',
  'service unavailable',
  'econnreset',
  'etimedout',
  'enotfound',
  'fetch failed',
  'socket hang up',
  'connection refused',
];

/** Substrings that mark a failure as permanent (retrying cannot help). */
const PERMANENT_HINTS = [
  'insufficient',
  'invalid',
  'could not find',
  'owner does not match',
  'custom program error',
  'account not found',
  'malformed',
];

/**
 * Classify a pre-submission error (token-account resolution, blockhash fetch,
 * or `sendRawTransaction` rejection). At this point the transaction has NOT
 * been accepted by the network, so retrying is always money-safe — we only
 * mark it permanent when the message clearly indicates an unfixable condition.
 */
function classifyPreSubmit(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (RETRYABLE_HINTS.some((h) => lower.includes(h))) return new TransferRetryableError(msg);
  if (PERMANENT_HINTS.some((h) => lower.includes(h))) return new TransferPermanentError(msg);
  // Unknown pre-submit failure: nothing was sent, so retrying is safe.
  return new TransferRetryableError(msg);
}

/**
 * Real devnet USDC payout provider (Sprint 31).
 *
 * Builds and submits an SPL `transferChecked` from the vault's USDC ATA to the
 * recipient's ATA (created on demand, vault pays rent). The flow is split into
 * submit + confirm precisely so the money-safety story is explicit:
 *
 *   - Any error BEFORE the cluster accepts the tx → retryable (nothing moved).
 *   - Blockhash-expired during confirm → retryable (the tx can never land now).
 *   - Any OTHER post-submission ambiguity → **permanent**, so the runner does
 *     NOT auto-retry and risk a double payout. An operator reconciles on chain.
 *
 * Mainnet remains out of scope (signer hardening / KMS is a separate track).
 */
export class DevnetSolanaTransferProvider implements SolanaTransferProvider {
  readonly name = 'devnet_solana';

  constructor(private readonly config: DevnetConfig) {}

  async buildAndSubmitTransfer(input: TransferInput): Promise<TransferResult> {
    const { rpcUrl, vaultSecretKeyBase58, usdcMint } = this.config;
    const commitment: Commitment = this.config.commitment ?? 'confirmed';

    // ── 1. Config + input validation (permanent: retrying cannot help) ──
    if (!rpcUrl || !vaultSecretKeyBase58 || !usdcMint) {
      throw new TransferPermanentError(
        'devnet transfer provider not configured (rpc url / vault key / usdc mint missing)',
      );
    }

    let vault: Keypair;
    try {
      vault = Keypair.fromSecretKey(bs58.decode(vaultSecretKeyBase58));
    } catch {
      // Deliberately echo NO key material.
      throw new TransferPermanentError('vault secret key is not valid base58 of the expected length');
    }

    let mint: PublicKey;
    try {
      mint = new PublicKey(usdcMint);
    } catch {
      throw new TransferPermanentError(`invalid USDC mint address: ${usdcMint}`);
    }

    let destOwner: PublicKey;
    try {
      destOwner = new PublicKey(input.toWallet);
    } catch {
      throw new TransferPermanentError(`invalid destination wallet: ${input.toWallet}`);
    }

    let amountRaw: bigint;
    try {
      amountRaw = toRawUnits(input.amountUsdc);
    } catch (err) {
      throw new TransferPermanentError(
        `invalid amount ${input.amountUsdc}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (amountRaw <= 0n) {
      throw new TransferPermanentError(`amount must be > 0 (got ${input.amountUsdc})`);
    }

    const connection = new Connection(rpcUrl, commitment);

    // ── 2. Resolve token accounts + build/sign (still pre-submission) ──
    let signature: string;
    let blockhash: string;
    let lastValidBlockHeight: number;
    try {
      const sourceAta = await getAssociatedTokenAddress(mint, vault.publicKey);
      // Creates the recipient ATA if missing (vault is payer + signer).
      const destAccount = await getOrCreateAssociatedTokenAccount(connection, vault, mint, destOwner);

      const ix = createTransferCheckedInstruction(
        sourceAta,
        mint,
        destAccount.address,
        vault.publicKey,
        amountRaw,
        USDC_DECIMALS,
      );

      const latest = await connection.getLatestBlockhash(commitment);
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;

      const tx = new Transaction({
        feePayer: vault.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix);
      tx.sign(vault);

      // maxRetries:0 — we never want the RPC client silently re-broadcasting;
      // a single submission keeps the double-pay reasoning tractable.
      signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 0,
      });
    } catch (err) {
      // Nothing was accepted by the cluster yet → safe to retry (unless clearly permanent).
      throw classifyPreSubmit(err);
    }

    // ── 3. Confirm (post-submission ambiguity must NOT auto-retry) ──
    try {
      const res = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment,
      );
      if (res.value.err) {
        // The tx landed but failed on-chain — no funds moved. Treat as permanent
        // so an operator inspects the cause (e.g. vault USDC underfunded) before
        // anything is re-attempted.
        throw new TransferPermanentError(
          `transaction ${signature} failed on-chain: ${JSON.stringify(res.value.err)}`,
        );
      }
    } catch (err) {
      if (err instanceof TransferPermanentError) throw err;
      if (err instanceof TransactionExpiredBlockheightExceededError) {
        // Blockhash expired before confirmation → guaranteed never processed.
        throw new TransferRetryableError(
          `confirmation expired for ${signature}; transaction was not processed, safe to retry`,
        );
      }
      // Submitted but confirmation unknown: refuse to auto-retry (double-pay risk).
      throw new TransferPermanentError(
        `confirmation ambiguous for submitted tx ${signature}; manual on-chain reconciliation required before any retry`,
      );
    }

    return { txSignature: signature };
  }
}
