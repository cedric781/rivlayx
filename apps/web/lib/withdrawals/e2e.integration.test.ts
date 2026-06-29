import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deposits as coreDeposits, ledger, payouts, withdrawals } from '@rivlayx/core';
import { wallets, withdrawalRequests } from '@rivlayx/db';
import type { IHeliusRpc, ParsedTransfer } from '@rivlayx/helius';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { requestWithdrawal } from './request';

/**
 * Sprint 31 end-to-end money flow, against the real deposit + withdrawal engines
 * with the deterministic mock transfer provider:
 *
 *   deposit (25) → balance 25 → withdraw request (10) → admin approve → runner
 *   → tx signature → status paid → balance 15 → reconciliation ok
 *
 * The on-chain transfer itself is mocked (a live devnet payout needs a funded
 * vault + network); everything else is the production code path.
 */

const SOURCE_WALLET = 'SourceWa11etDeposit1111111111111111111111111';
const VAULT_ATA = 'DevVaultAta11111111111111111111111111111111';
const DEST_WALLET = 'So11111111111111111111111111111111111111112';

const DEPOSIT_CONFIG = {
  minDepositUsdc: '5',
  maxSingleDepositUsdc: '250',
  maxTvlUsdc: '1000',
  expectedDestAta: VAULT_ATA,
};

/** Webhook-style finality RPC: a delivered signature is treated as finalized. */
const finalityRpc: IHeliusRpc = {
  async getSignatureStatus(signature: string) {
    return { signature, confirmationStatus: 'finalized', confirmations: null, slot: null, err: null };
  },
  async getTokenAccountBalance() {
    throw new Error('unused in this test');
  },
  async getSignaturesForAddress() {
    throw new Error('unused in this test');
  },
};

function depositTransfer(signature: string, amountUsdc: string): ParsedTransfer {
  return {
    signature,
    slot: 1,
    timestamp: 1_718_600_000,
    sourceWallet: SOURCE_WALLET,
    destWallet: 'VaultOwner1111111111111111111111111111111111',
    sourceAta: null,
    destAta: VAULT_ATA,
    amountUsdc,
    mint: USDC_MINT_ADDRESS,
  };
}

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
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.deposits CASCADE; TRUNCATE financial.orphan_deposits CASCADE; ' +
      'TRUNCATE financial.withdrawal_requests CASCADE; ' +
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all');",
  );
});

describe('withdrawal E2E — deposit → request → approve → runner → paid', () => {
  it('moves real USDC through the full flow and keeps reconciliation green', async () => {
    const db = harness.db;
    const user = await createTestUser(db);
    const adminUser = await createTestUser(db);
    await db.insert(wallets).values({
      userId: user.id,
      chain: 'solana',
      address: SOURCE_WALLET,
      source: 'mock_dev',
      isPrimary: true,
    });

    // ── Deposit 25 USDC via the real detect → confirm → credit pipeline ──
    const detect = await coreDeposits.detectDeposit(
      db,
      depositTransfer('depositsig_e2e', '25'),
      DEPOSIT_CONFIG,
    );
    expect(detect.kind).toBe('deposit');
    if (detect.kind !== 'deposit') throw new Error('deposit not detected');

    const confirm = await coreDeposits.confirmDeposit(db, finalityRpc, detect.depositId);
    expect(confirm.kind).toBe('confirmed');

    const credit = await coreDeposits.creditDeposit(db, detect.depositId);
    expect(credit.kind).toBe('credited');

    expect((await ledger.getBalance(db, user.id))!.availableUsdc).toBe('25.000000');

    // ── Withdraw request 10 ──
    const req = await requestWithdrawal(db, {
      userId: user.id,
      amountUsdc: '10',
      destinationWallet: DEST_WALLET,
    });
    expect(req.status).toBe('pending_review');

    // ── Admin approve → approved ──
    const approved = await withdrawals.approveWithdrawal(db, {
      requestId: req.id,
      adminUserId: adminUser.id,
      actorRole: 'admin',
    });
    expect(approved.status).toBe('approved');

    // ── Runner drains the queue (mock transfer provider) → paid ──
    const provider = new payouts.MockSolanaTransferProvider();
    const result = await withdrawals.processWithdrawalQueue(db, provider);
    expect(result.paid).toBe(1);
    expect(result.skippedFrozen).toBe(false);

    const [row] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, req.id));
    expect(row!.status).toBe('paid');
    expect(row!.txSignature).toBeTruthy(); // no payout without a tx signature
    expect(row!.ledgerTxnId).toBeTruthy();
    expect(row!.paidAt).toBeTruthy();

    // ── Balance debited 25 → 15, ledger still balanced ──
    expect((await ledger.getBalance(db, user.id))!.availableUsdc).toBe('15.000000');

    const recon = await ledger.runReconciliation(db);
    expect(recon.status).toBe('ok');
  });

  it('a second runner pass does not pay the same request twice', async () => {
    const db = harness.db;
    const user = await createTestUser(db);
    const adminUser = await createTestUser(db);
    await db.insert(wallets).values({
      userId: user.id,
      chain: 'solana',
      address: SOURCE_WALLET,
      source: 'mock_dev',
      isPrimary: true,
    });

    const detect = await coreDeposits.detectDeposit(
      db,
      depositTransfer('depositsig_dup', '25'),
      DEPOSIT_CONFIG,
    );
    if (detect.kind !== 'deposit') throw new Error('deposit not detected');
    await coreDeposits.confirmDeposit(db, finalityRpc, detect.depositId);
    await coreDeposits.creditDeposit(db, detect.depositId);

    const req = await requestWithdrawal(db, {
      userId: user.id,
      amountUsdc: '10',
      destinationWallet: DEST_WALLET,
    });
    await withdrawals.approveWithdrawal(db, { requestId: req.id, adminUserId: adminUser.id });

    const provider = new payouts.MockSolanaTransferProvider();
    const first = await withdrawals.processWithdrawalQueue(db, provider);
    expect(first.paid).toBe(1);
    const second = await withdrawals.processWithdrawalQueue(db, provider);
    expect(second.paid).toBe(0); // nothing left in 'approved'

    expect((await ledger.getBalance(db, user.id))!.availableUsdc).toBe('15.000000');
    expect((await ledger.runReconciliation(db)).status).toBe('ok');
  });
});
