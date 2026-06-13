import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deposits, orphanDeposits, wallets } from '@rivlayx/db';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { buildMockTokenTransfer, parseSplTransfer } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { detectDeposit } from './detect';
import { postLedgerTxn } from '../ledger/post';
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
    'TRUNCATE auth.users CASCADE; ' +
      'TRUNCATE financial.ledger_entries; ' +
      'TRUNCATE financial.balances; ' +
      'TRUNCATE financial.deposits; ' +
      'TRUNCATE financial.orphan_deposits;',
  );
});

async function userWithWallet(walletAddress: string) {
  const user = await createTestUser(harness.db);
  await harness.db.insert(wallets).values({
    userId: user.id,
    chain: 'solana',
    address: walletAddress,
    source: 'mock_dev',
    isPrimary: true,
  });
  return user;
}

function buildTransfer(opts: { sourceWallet: string; amountUsdc: number; signature?: string }) {
  const event = buildMockTokenTransfer({
    sourceWallet: opts.sourceWallet,
    destAta: VAULT_ATA,
    amountUsdc: opts.amountUsdc,
    signature: opts.signature,
  });
  return parseSplTransfer(event, PARSE_OPTS);
}

describe('detectDeposit — happy path', () => {
  it('inserts a pending deposit for a known user', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    const user = await userWithWallet(wallet);
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 50 });

    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit');

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.userId, user.id));
    expect(row?.status).toBe('pending');
    expect(row?.amountUsdc).toBe('50.000000');
    expect(row?.sourceWallet).toBe(wallet);
    expect(row?.txSignature).toBe(transfer.signature);
  });
});

describe('detectDeposit — orphan path', () => {
  it('routes unknown source wallet to orphan_deposits', async () => {
    const transfer = buildTransfer({
      sourceWallet: 'UnknownWallet1111111111111111111111111111',
      amountUsdc: 25,
    });

    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('orphan');

    const orphans = await harness.db.select().from(orphanDeposits);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.sourceWallet).toBe('UnknownWallet1111111111111111111111111111');
    expect(orphans[0]?.amountUsdc).toBe('25.000000');
    expect(orphans[0]?.status).toBe('pending_review');

    const userDeposits = await harness.db.select().from(deposits);
    expect(userDeposits).toHaveLength(0);
  });
});

describe('detectDeposit — duplicates', () => {
  it('returns duplicate when tx_signature already in deposits', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    await userWithWallet(wallet);
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 50 });

    await detectDeposit(harness.db, transfer, CONFIG);
    const result = await detectDeposit(harness.db, transfer, CONFIG);

    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.existingTable).toBe('deposits');
    }
    const rows = await harness.db.select().from(deposits);
    expect(rows).toHaveLength(1);
  });

  it('returns duplicate when tx_signature already in orphan_deposits', async () => {
    const transfer = buildTransfer({
      sourceWallet: 'Unknown1111111111111111111111111111111111',
      amountUsdc: 10,
    });
    await detectDeposit(harness.db, transfer, CONFIG);
    const result = await detectDeposit(harness.db, transfer, CONFIG);

    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.existingTable).toBe('orphan_deposits');
    }
  });
});

describe('detectDeposit — amount limits', () => {
  it('rejects deposit below MIN_DEPOSIT_USDC', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    await userWithWallet(wallet);
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 1 });

    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit_rejected');
    if (result.kind === 'deposit_rejected') {
      expect(result.reason).toBe('amount_too_small');
    }

    const [row] = await harness.db.select().from(deposits);
    expect(row?.status).toBe('rejected');
    expect(row?.rejectionReason).toBe('amount_too_small');
  });

  it('accepts deposit exactly at MIN_DEPOSIT_USDC', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    await userWithWallet(wallet);
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 5 });

    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit');
  });

  it('rejects deposit above MAX_SINGLE_DEPOSIT_USDC', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    await userWithWallet(wallet);
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 251 });

    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit_rejected');
    if (result.kind === 'deposit_rejected') {
      expect(result.reason).toBe('amount_too_large');
    }
  });

  it('accepts deposit exactly at MAX_SINGLE_DEPOSIT_USDC', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    await userWithWallet(wallet);
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 250 });

    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit');
  });
});

describe('detectDeposit — TVL cap', () => {
  it('rejects when crediting would push TVL over cap', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    const user = await userWithWallet(wallet);

    // Seed ledger with 900 already credited to user.
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'detect-test',
      entries: [
        {
          accountType: 'deposit_holding',
          accountRef: 'vault',
          direction: 'debit',
          amountUsdc: '900',
          reason: 'deposit',
        },
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'credit',
          amountUsdc: '900',
          reason: 'deposit',
        },
      ],
    });

    // 200 incoming would push TVL to 1100 > 1000 cap.
    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 200 });
    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit_rejected');
    if (result.kind === 'deposit_rejected') {
      expect(result.reason).toBe('tvl_cap_exceeded');
    }
  });

  it('allows when crediting hits cap exactly', async () => {
    const wallet = 'UserWallet111111111111111111111111111111111';
    const user = await userWithWallet(wallet);

    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'detect-test',
      entries: [
        {
          accountType: 'deposit_holding',
          accountRef: 'vault',
          direction: 'debit',
          amountUsdc: '800',
          reason: 'deposit',
        },
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'credit',
          amountUsdc: '800',
          reason: 'deposit',
        },
      ],
    });

    const transfer = buildTransfer({ sourceWallet: wallet, amountUsdc: 200 });
    const result = await detectDeposit(harness.db, transfer, CONFIG);
    expect(result.kind).toBe('deposit');
  });
});
