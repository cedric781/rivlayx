import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { betEvidence } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { submitEvidence } from './evidence';
import { acceptBet } from './accept';
import { createBet } from './create';
import {
  baseSportsBetInput,
  createActiveBet,
  fundUser,
  futureIso,
  linkTestWallet,
} from './test-helpers';

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
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all'); " +
      'TRUNCATE app.bets CASCADE;',
  );
});

async function makeEvidenceBet() {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '100');
  await fundUser(harness.db, acceptor.id, '100');

  const input = {
    ...baseSportsBetInput(creator.id),
    betType: 'open_objective' as const,
    templateId: undefined,
    resolveType: 'evidence' as const,
    resolveSource: { evidenceSpec: 'GPX track + photo' },
    title: 'Alice runs 10km before Sunday',
    predicate: {
      type: 'distance_completed',
      distanceKm: 10,
      deadlineAt: futureIso(86_400_000 * 3),
      subject: 'Alice',
    },
    creatorSide: 'completes',
    evidenceDeadline: futureIso(86_400_000 * 3),
  };
  const { bet } = await createBet(harness.db, input);
  await acceptBet(harness.db, {
    betId: bet.id,
    acceptorUserId: acceptor.id,
    acceptorSide: 'fails',
  });
  return { creator, acceptor, betId: bet.id };
}

describe('submitEvidence', () => {
  it('records evidence for a participant on an ACTIVE evidence-resolve bet', async () => {
    const { creator, betId } = await makeEvidenceBet();
    const result = await submitEvidence(harness.db, {
      betId,
      uploaderUserId: creator.id,
      storageKey: 'evidence/abc123.jpg',
      sha256: 'a'.repeat(64),
      contentType: 'image/jpeg',
      metadata: { exif: 'stripped' },
    });
    expect(result.evidence.uploaderUserId).toBe(creator.id);
    expect(result.evidence.storageKey).toBe('evidence/abc123.jpg');

    const rows = await harness.db.select().from(betEvidence).where(eq(betEvidence.betId, betId));
    expect(rows).toHaveLength(1);
  });

  it('rejects when uploader is not a participant', async () => {
    const { betId } = await makeEvidenceBet();
    const stranger = await createTestUser(harness.db);
    await expect(
      submitEvidence(harness.db, {
        betId,
        uploaderUserId: stranger.id,
        storageKey: 'evidence/x.jpg',
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/NOT_AUTHORIZED|participant/);
  });

  it('rejects when bet is not evidence-resolve', async () => {
    const creator = await createTestUser(harness.db);
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, creator.id);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, creator.id, '50');
    await fundUser(harness.db, acceptor.id, '50');
    const betId = await createActiveBet(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await expect(
      submitEvidence(harness.db, {
        betId,
        uploaderUserId: creator.id,
        storageKey: 'x',
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/INVALID_RESOLVE_CONFIG|evidence/);
  });

  it('rejects past the evidence deadline', async () => {
    const { creator, betId } = await makeEvidenceBet();
    // Force deadline into the past.
    await harness.db.execute(
      `UPDATE "app"."bets" SET evidence_deadline = now() - interval '1 hour' WHERE id = '${betId}'`,
    );
    await expect(
      submitEvidence(harness.db, {
        betId,
        uploaderUserId: creator.id,
        storageKey: 'x',
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow(/EXPIRED_WINDOW|deadline/);
  });

  it('enforces max 5 uploads per user per bet', async () => {
    const { creator, betId } = await makeEvidenceBet();
    for (let i = 0; i < 5; i++) {
      await submitEvidence(harness.db, {
        betId,
        uploaderUserId: creator.id,
        storageKey: `evidence/${i}.jpg`,
        sha256: `${i}`.repeat(64).slice(0, 64),
      });
    }
    await expect(
      submitEvidence(harness.db, {
        betId,
        uploaderUserId: creator.id,
        storageKey: 'evidence/six.jpg',
        sha256: 'b'.repeat(64),
      }),
    ).rejects.toThrow(/cap reached|max/);
  });
});
