import Decimal from 'decimal.js';
import { z } from 'zod';
import { accountTypeValues, directionValues, ledgerReasonValues } from '@rivlayx/db';
import { LedgerError } from './errors';
import { LOCKED_ACCOUNT_TYPES } from './accounting';
import type { PostLedgerTxnInput } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

const EntrySchema = z.object({
  accountType: z.enum(accountTypeValues),
  accountRef: z.string().min(1).max(64),
  direction: z.enum(directionValues),
  amountUsdc: z.string().regex(AMOUNT_RE, 'amount must be decimal with up to 6 places'),
  reason: z.enum(ledgerReasonValues),
  betId: z.string().regex(UUID_RE).nullish(),
  relatedTxSignature: z.string().max(128).nullish(),
  affectsUserId: z.string().regex(UUID_RE).nullish(),
});

const TxnSchema = z.object({
  txnId: z.string().regex(UUID_RE),
  requestId: z.string().regex(UUID_RE),
  createdBy: z.string().min(1).max(64),
  entries: z.array(EntrySchema).min(2),
});

export type ValidatedTxn = z.infer<typeof TxnSchema>;

/**
 * Parse the txn against the schema, then verify business invariants:
 *   I1: every amount > 0
 *   I2: sum(debits) == sum(credits)
 *   I3: at least one debit and one credit
 *   I4: locked-account entries carry `affectsUserId`
 *   I5: user_available `accountRef` is a UUID, and `affectsUserId` (if set)
 *       equals `accountRef`
 *
 * Throws `LedgerError` with a code on any violation.
 */
export function validateLedgerTxn(input: PostLedgerTxnInput): ValidatedTxn {
  const parsed = TxnSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new LedgerError('INVALID_INPUT', `Invalid ledger txn:\n${issues}`);
  }
  const txn = parsed.data;

  let debitSum = new Decimal(0);
  let creditSum = new Decimal(0);

  for (const e of txn.entries) {
    const amt = new Decimal(e.amountUsdc);
    if (amt.lte(0)) {
      throw new LedgerError('AMOUNT_NOT_POSITIVE', 'Entry amount must be > 0');
    }
    if (e.direction === 'debit') debitSum = debitSum.add(amt);
    else creditSum = creditSum.add(amt);
  }

  if (!debitSum.eq(creditSum)) {
    throw new LedgerError(
      'UNBALANCED',
      `Debits ${debitSum.toFixed(6)} != credits ${creditSum.toFixed(6)}`,
    );
  }

  if (debitSum.isZero() || creditSum.isZero()) {
    throw new LedgerError('SINGLE_SIDED', 'Txn must have at least one debit and one credit');
  }

  for (const e of txn.entries) {
    if (LOCKED_ACCOUNT_TYPES.has(e.accountType) && !e.affectsUserId) {
      throw new LedgerError(
        'MISSING_AFFECTS_USER',
        `Entry on ${e.accountType} requires affectsUserId`,
      );
    }
    if (e.accountType === 'user_available') {
      if (!UUID_RE.test(e.accountRef)) {
        throw new LedgerError('INVALID_USER_REF', 'user_available account_ref must be a user UUID');
      }
      if (e.affectsUserId && e.affectsUserId !== e.accountRef) {
        throw new LedgerError(
          'INCONSISTENT_AFFECTS_USER',
          'user_available account_ref must equal affectsUserId',
        );
      }
    }
  }

  return txn;
}
