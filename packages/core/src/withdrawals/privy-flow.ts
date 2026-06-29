import type { OnchainTransfer } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';
import type { EscrowConfig } from '../escrow/config';
import { prepareWithdrawal } from '../escrow/withdraw';
import { OnchainTransferError, getTransfer, markSubmitted } from '../escrow/transfers';
import { isFrozen } from '../ledger/freeze';
import { getBalance } from '../ledger/balances';
import { resolveDelegatedEmbeddedWallet } from '../payouts/embedded-wallet';
import type { SolanaTransferProvider } from '../payouts/types';
import { WithdrawalError } from './errors';
import { WITHDRAWAL_LIMITS, checkDailyCap, coversAmount, type WithdrawalLimits } from './cap';
import { withdrawnLast24hUsdc } from './query';

/**
 * Privy withdrawal flow (Phase 6 prerequisite — NOT wired into the live
 * withdrawals cron; the raw-vault runner stays the production path). Ties the
 * delegated-signing pieces together end-to-end, behind the SAME safety guards as
 * the production withdrawal runner — nothing signs until they all pass:
 *
 *   1. Resolve + verify the user's delegated Privy embedded wallet (the source).
 *   2. Freeze guard      — refuse while `withdrawals` is frozen.
 *   3. Balance guard     — refuse when available balance does not cover it.
 *   4. Daily-cap guard   — refuse when the rolling 24h cap would be exceeded.
 *   5. Prepare           — validate dynamic destination + create the idempotent
 *                          `withdrawal:{requestId}` onchain_transfers record.
 *   6. Delegated sign+send via the injected provider (policy guard + Privy).
 *   7. Record the signature on the transfer record (pending → submitted).
 *
 * The three guards reuse the runner's exact implementations (`isFrozen`,
 * `getBalance` + `coversAmount`, `withdrawnLast24hUsdc` + `checkDailyCap`) — no
 * business logic is duplicated. A failed guard throws `WithdrawalError` BEFORE
 * any signer/provider call or `markSubmitted`, so a rejected withdrawal never
 * moves money.
 *
 * Idempotent + replay-safe on `requestId`: a replay returns the same record and
 * the same signature (the provider is idempotent on `reference`), never a second
 * transfer. Writes ONLY `onchain_transfers` — it does not post the ledger or
 * change the withdrawal-request status; those remain the runner's responsibility
 * and are untouched here.
 */

export interface ExecutePrivyWithdrawalInput {
  /** Withdrawal-request id — the idempotency anchor. */
  requestId: string;
  userId: string;
  /** External destination wallet (base58). */
  destinationWallet: string;
  amountUsdc: string;
}

export interface ExecutePrivyWithdrawalOptions {
  escrowConfig: EscrowConfig;
  /** The Privy (or mock) transfer provider — injected so this stays testable. */
  provider: SolanaTransferProvider;
  /** Cap source for the freeze/balance/daily guards. Defaults to WITHDRAWAL_LIMITS. */
  limits?: WithdrawalLimits;
  /** Evaluation time for the rolling daily cap. Defaults to now. */
  now?: Date;
  /** Per-request withdrawal cap for prepareWithdrawal. Defaults to the limits cap. */
  maxWithdrawUsdc?: string;
}

export interface ExecutePrivyWithdrawalResult {
  transfer: OnchainTransfer;
  txSignature: string;
  /** False when an existing transfer record was replayed (idempotent). */
  created: boolean;
}

export async function executePrivyWithdrawal(
  db: LedgerDb,
  input: ExecutePrivyWithdrawalInput,
  options: ExecutePrivyWithdrawalOptions,
): Promise<ExecutePrivyWithdrawalResult> {
  const now = options.now ?? new Date();
  const limits = options.limits ?? WITHDRAWAL_LIMITS;

  // ── 1. Source: the user's verified, delegated embedded wallet ──
  const { address: fromWallet } = await resolveDelegatedEmbeddedWallet(db, input.userId);

  // ── 2-4. Safety guards — the SAME guarantees the raw-vault runner enforces.
  // NOTHING signs until all pass; the first failure throws immediately. ──

  // 2. Freeze
  if (await isFrozen(db, 'withdrawals')) {
    throw new WithdrawalError('FROZEN', 'withdrawals are frozen');
  }

  // 3. Available balance
  const balance = await getBalance(db, input.userId);
  if (!coversAmount(balance?.availableUsdc ?? '0', input.amountUsdc)) {
    throw new WithdrawalError(
      'INSUFFICIENT_BALANCE',
      'available balance does not cover this withdrawal',
    );
  }

  // 4. Rolling daily cap
  const priorUsdc = await withdrawnLast24hUsdc(db, input.userId, now, input.requestId);
  const dailyCheck = checkDailyCap(priorUsdc, input.amountUsdc, limits.maxDailyUsdc);
  if (!dailyCheck.ok) {
    throw new WithdrawalError(dailyCheck.code, dailyCheck.message);
  }

  // ── 5. Prepare (validate dynamic destination + create the idempotent record) ──
  const prepared = await prepareWithdrawal(
    db,
    {
      requestId: input.requestId,
      userId: input.userId,
      fromWallet,
      destinationWallet: input.destinationWallet,
      amountUsdc: input.amountUsdc,
    },
    { escrowConfig: options.escrowConfig, maxWithdrawUsdc: options.maxWithdrawUsdc ?? limits.maxWithdrawUsdc },
  );

  // ── 6. Single-execution short-circuit. Once a transfer is submitted/finalized
  // the record carries its signature; a replay returns it WITHOUT calling the
  // provider/signer again — no duplicate provider execution, no duplicate
  // signing. (A crash before submit leaves the record `pending` with no
  // signature, so a retry below resumes it safely.) ──
  if (prepared.transfer.txSignature) {
    return {
      transfer: prepared.transfer,
      txSignature: prepared.transfer.txSignature,
      created: prepared.created,
    };
  }

  // ── 7. Delegated sign + send (policy guard runs inside the provider). The
  // provider is idempotent on `reference`, so even a concurrent second call here
  // resolves to the SAME signature — one logical transfer, one execution. ──
  const { txSignature } = await options.provider.buildAndSubmitTransfer(prepared.transferInput);

  // ── 8. Record pending → submitted. The transition is a guarded atomic UPDATE
  // (pending → submitted only), so a duplicate submit is impossible. If a
  // concurrent run already advanced the row, `markSubmitted` throws
  // INVALID_TRANSITION → treat as success and re-read (same signature). ──
  let transfer = prepared.transfer;
  if (transfer.status === 'pending') {
    try {
      transfer = await markSubmitted(db, transfer.id, txSignature);
    } catch (err) {
      if (err instanceof OnchainTransferError && err.code === 'INVALID_TRANSITION') {
        transfer = (await getTransfer(db, transfer.id)) ?? transfer;
      } else {
        throw err;
      }
    }
  }

  return { transfer, txSignature: transfer.txSignature ?? txSignature, created: prepared.created };
}
