import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { balances, deposits, wallets } from '@rivlayx/db';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import {
  MockHeliusRpc,
  buildMockTokenTransfer,
  parseSplTransfer,
  type SignatureStatus,
} from '@rivlayx/helius';
import { deposits as coreDeposits } from '@rivlayx/core';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';

/**
 * Deposit-ingress e2e (C6B/C). Exercises the composition the two routes
 * orchestrate: the webhook does DETECT-ONLY (no credit), and the poller credits
 * only at real `finalized` finality. Proves no balance moves on detection, that
 * crediting is poller-driven, and that duplicate/replayed signatures never
 * double-credit (tx_signature UNIQUE + ledger idempotency).
 */

const VAULT_ATA = 'VaultAta1111111111111111111111111111111111';
const PARSE_OPTS = { expectedMint: USDC_MINT_ADDRESS, expectedDestAta: VAULT_ATA };
const CONFIG = {
  minDepositUsdc: '5',
  maxSingleDepositUsdc: '250',
  maxTvlUsdc: '1000',
  expectedDestAta: VAULT_ATA,
};

const FINALIZED = (signature: string): SignatureStatus => ({
  signature,
  confirmationStatus: 'finalized',
  confirmations: null,
  slot: 1,
  err: null,
});

let harness: TestDb;
let rpc: MockHeliusRpc;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  rpc = new MockHeliusRpc();
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; ' +
      'TRUNCATE financial.balances; TRUNCATE financial.deposits;',
  );
});

let n = 0;
async function linkedUser(): Promise<{ userId: string; wallet: string }> {
  const wallet = `UserWallet${(n++).toString().padStart(33, '0')}`;
  const user = await createTestUser(harness.db);
  await harness.db
    .insert(wallets)
    .values({ userId: user.id, chain: 'solana', address: wallet, source: 'mock_dev', isPrimary: true });
  return { userId: user.id, wallet };
}

/** Simulate the webhook's detect-only step for a transfer. */
async function webhookDetect(wallet: string, amount: number, signature?: string) {
  const event = buildMockTokenTransfer({ sourceWallet: wallet, destAta: VAULT_ATA, amountUsdc: amount, signature });
  const transfer = parseSplTransfer(event, PARSE_OPTS);
  return coreDeposits.detectDeposit(harness.db, transfer, CONFIG, event);
}

async function balanceOf(userId: string): Promise<string> {
  const [row] = await harness.db.select().from(balances).where(eq(balances.userId, userId));
  return row?.availableUsdc ?? '0';
}

describe('deposit ingress e2e', () => {
  it('webhook detect creates a pending row and credits nothing', async () => {
    const { userId, wallet } = await linkedUser();
    const detect = await webhookDetect(wallet, 50);

    expect(detect.kind).toBe('deposit');
    const [row] = await harness.db.select().from(deposits);
    expect(row?.status).toBe('pending');
    expect(await balanceOf(userId)).toBe('0'); // no balance moved on detection
  });

  it('poller credits only after finalized finality', async () => {
    const { userId, wallet } = await linkedUser();
    const detect = await webhookDetect(wallet, 50);
    if (detect.kind !== 'deposit') throw new Error('expected pending');

    // Before finality: poller leaves it pending, no credit.
    const r1 = await coreDeposits.processPendingDeposits(harness.db, rpc);
    expect(r1.credited).toBe(0);
    expect(await balanceOf(userId)).toBe('0');

    // After finalized: poller credits.
    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, detect.depositId));
    rpc.setSignatureStatus(row!.txSignature, FINALIZED(row!.txSignature));
    const r2 = await coreDeposits.processPendingDeposits(harness.db, rpc);
    expect(r2.credited).toBe(1);
    expect(await balanceOf(userId)).toBe('50.000000');
  });

  it('a duplicate / replayed webhook never double-credits', async () => {
    const { userId, wallet } = await linkedUser();
    const first = await webhookDetect(wallet, 50, 'dup-sig-1');
    expect(first.kind).toBe('deposit');

    // Replay the exact same signature (webhook retry / attacker replay).
    const replay = await webhookDetect(wallet, 50, 'dup-sig-1');
    expect(replay.kind).toBe('duplicate');

    // Only one deposit row exists.
    const rows = await harness.db.select().from(deposits);
    expect(rows).toHaveLength(1);

    // Finalize + run the poller twice — still exactly one credit.
    rpc.setSignatureStatus('dup-sig-1', FINALIZED('dup-sig-1'));
    await coreDeposits.processPendingDeposits(harness.db, rpc);
    await coreDeposits.processPendingDeposits(harness.db, rpc);
    expect(await balanceOf(userId)).toBe('50.000000');
  });

  it('enforces tx_signature uniqueness across detection attempts', async () => {
    const { wallet } = await linkedUser();
    await webhookDetect(wallet, 30, 'unique-sig');
    const again = await webhookDetect(wallet, 30, 'unique-sig');
    expect(again.kind).toBe('duplicate');
    const rows = await harness.db.select().from(deposits);
    expect(rows).toHaveLength(1);
  });
});
