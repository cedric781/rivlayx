import { randomUUID } from 'node:crypto';
import { wallets } from '@rivlayx/db';
import { postLedgerTxn } from '../ledger/post';
import type { LedgerDb } from '../ledger/types';
import { acceptBet } from './accept';
import { createBet } from './create';
import { transitionToAwaitingResult } from './resolve';
import type { CreateBetInput } from './types';

/**
 * Insert a primary Solana wallet for a test user. The bet engine requires
 * one to be present before allowing creation, so each test user needs this
 * after `createTestUser`.
 */
export async function linkTestWallet(
  db: LedgerDb,
  userId: string,
  address: string = `TestWallet${randomUUID().replace(/-/g, '').slice(0, 32)}`,
): Promise<string> {
  await db.insert(wallets).values({
    userId,
    chain: 'solana',
    address,
    source: 'mock_dev',
    isPrimary: true,
  });
  return address;
}

/** Credit a user's available balance via a synthetic deposit ledger txn. */
export async function fundUser(db: LedgerDb, userId: string, amountUsdc: string): Promise<void> {
  await postLedgerTxn(db, {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'bets-test-helpers:fund',
    entries: [
      {
        accountType: 'deposit_holding',
        accountRef: 'vault',
        direction: 'debit',
        amountUsdc,
        reason: 'deposit',
      },
      {
        accountType: 'user_available',
        accountRef: userId,
        direction: 'credit',
        amountUsdc,
        reason: 'deposit',
      },
    ],
  });
}

export function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

export const baseSportsBetInput = (creatorUserId: string): CreateBetInput => ({
  creatorUserId,
  betType: 'sports_template',
  templateId: 'football.match_winner',
  title: 'Ajax wins from PSV',
  predicate: {
    type: 'team_wins',
    team: 'Ajax',
    eventReference: 'apifootball:fixture:42',
  },
  resolveType: 'auto',
  resolveSource: { provider: 'api_football', externalEventId: '42' },
  arbiterType: 'none',
  stakePerSideUsdc: '10',
  creatorSide: 'home',
  expiresAt: futureIso(86_400_000),
  eventAt: futureIso(86_400_000 * 2),
});

/** Build a bet that is already in ACTIVE state. */
export async function createActiveBet(
  db: LedgerDb,
  opts: {
    creatorUserId: string;
    acceptorUserId: string;
    overrides?: Partial<CreateBetInput>;
  },
): Promise<string> {
  const input = { ...baseSportsBetInput(opts.creatorUserId), ...(opts.overrides ?? {}) };
  const { bet } = await createBet(db, input);
  await acceptBet(db, {
    betId: bet.id,
    acceptorUserId: opts.acceptorUserId,
    acceptorSide: 'away',
  });
  return bet.id;
}

/** Build a bet that is already in AWAITING_RESULT state. */
export async function createBetAwaitingResult(
  db: LedgerDb,
  opts: {
    creatorUserId: string;
    acceptorUserId: string;
    overrides?: Partial<CreateBetInput>;
  },
): Promise<string> {
  const betId = await createActiveBet(db, opts);
  await transitionToAwaitingResult(db, { betId });
  return betId;
}
