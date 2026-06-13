import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deposits, wallets } from '@rivlayx/db';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { buildMockTokenTransfer, parseSplTransfer } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { detectDeposit } from './detect';
import { creditDeposit } from './credit';
import { getBalance } from '../ledger/balances';
import type { DepositConfig } from './config';

const VAULT_ATA = 'VaultAta1111111111111111111111111111111111';
const PARSE_OPTS = { expectedMint: USDC_MINT_ADDRESS, expectedDestAta: VAULT_ATA };
const CONFIG: DepositConfig = {
  minDepositUsdc: '5',
  maxSingleDepositUsdc: '250',
  maxTvlUsdc: '1000',
  expectedDestAta: VAULT_ATA,
};

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; ' +
      'TRUNCATE financial.balances; TRUNCATE financial.deposits;',
  );
});

async function setupConfirmedDeposit(amount = 50): Promise<{ depositId: string; userId: string }> {
  const wallet = 'UserWallet111111111111111111111111111111111';
  const user = await createTestUser(harness.db);
  await harness.db.insert(wallets).values({
    userId: user.id,
    chain: 'solana',
    address: wallet,
    source: 'mock_dev',
    isPrimary: true,
  });
  const event = buildMockTokenTransfer({
    sourceWallet: wallet,
    destAta: VAULT_ATA,
    amountUsdc: amount,
  });
  const parsed = parseSplTransfer(event, PARSE_OPTS);
  const detect = await detectDeposit(harness.db, parsed, CONFIG);
  if (detect.kind !== 'deposit') throw new Error('expected pending deposit');
  await harness.db
    .update(deposits)
    .set({ status: 'confirmed', confirmedAt: new Date(), confirmations: 32 })
    .where(eq(deposits.id, detect.depositId));
  return { depositId: detect.depositId, userId: user.id };
}

describe('creditDeposit', () => {
  it('credits a confirmed deposit and updates the balance', async () => {
    const { depositId, userId } = await setupConfirmedDeposit(75);

    const result = await creditDeposit(harness.db, depositId);
    expect(result.kind).toBe('credited');

    const balance = await getBalance(harness.db, userId);
    expect(balance?.availableUsdc).toBe('75.000000');

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('credited');
    expect(row?.creditedAt).not.toBeNull();
    expect(row?.ledgerTxnId).not.toBeNull();
  });

  it('is idempotent — replay returns already_credited', async () => {
    const { depositId, userId } = await setupConfirmedDeposit(40);

    const first = await creditDeposit(harness.db, depositId);
    expect(first.kind).toBe('credited');

    const second = await creditDeposit(harness.db, depositId);
    expect(second.kind).toBe('already_credited');

    const balance = await getBalance(harness.db, userId);
    expect(balance?.availableUsdc).toBe('40.000000');
  });

  it('returns wrong_status when called on a pending deposit', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    const user = await createTestUser(harness.db);
    await harness.db.insert(wallets).values({
      userId: user.id,
      chain: 'solana',
      address: wallet,
      source: 'mock_dev',
      isPrimary: true,
    });
    const event = buildMockTokenTransfer({
      sourceWallet: wallet,
      destAta: VAULT_ATA,
      amountUsdc: 50,
    });
    const parsed = parseSplTransfer(event, PARSE_OPTS);
    const detect = await detectDeposit(harness.db, parsed, CONFIG);
    if (detect.kind !== 'deposit') throw new Error('expected pending deposit');

    const result = await creditDeposit(harness.db, detect.depositId);
    expect(result.kind).toBe('wrong_status');
    if (result.kind === 'wrong_status') {
      expect(result.status).toBe('pending');
    }
  });

  it('returns not_found for unknown depositId', async () => {
    const result = await creditDeposit(harness.db, '00000000-0000-0000-0000-000000000000');
    expect(result.kind).toBe('not_found');
  });
});
