import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { isFrozen, setFreeze } from './freeze';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  // Reset all freeze components to default (unfrozen). Re-seed via TRUNCATE+INSERT.
  await harness.pg.exec(
    'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all');",
  );
  await harness.pg.exec('TRUNCATE auth.users CASCADE;');
});

describe('freeze_state — defaults', () => {
  it('reports all components as unfrozen by default', async () => {
    expect(await isFrozen(harness.db, 'new_bets')).toBe(false);
    expect(await isFrozen(harness.db, 'settlements')).toBe(false);
    expect(await isFrozen(harness.db, 'withdrawals')).toBe(false);
    expect(await isFrozen(harness.db, 'all')).toBe(false);
  });
});

describe('setFreeze + isFrozen', () => {
  it('freezing a specific component does not freeze the others', async () => {
    const admin = await createTestUser(harness.db, { roles: ['user', 'admin'] });
    await setFreeze(harness.db, 'settlements', true, {
      actorUserId: admin.id,
      reason: 'manual hold during recon',
    });
    expect(await isFrozen(harness.db, 'settlements')).toBe(true);
    expect(await isFrozen(harness.db, 'withdrawals')).toBe(false);
    expect(await isFrozen(harness.db, 'new_bets')).toBe(false);
  });

  it('all=true overrides every component check', async () => {
    const admin = await createTestUser(harness.db, { roles: ['user', 'super_admin'] });
    await setFreeze(harness.db, 'all', true, {
      actorUserId: admin.id,
      reason: 'incident response',
    });
    expect(await isFrozen(harness.db, 'all')).toBe(true);
    expect(await isFrozen(harness.db, 'settlements')).toBe(true);
    expect(await isFrozen(harness.db, 'withdrawals')).toBe(true);
    expect(await isFrozen(harness.db, 'new_bets')).toBe(true);
  });

  it('unfreezing restores per-component state', async () => {
    const admin = await createTestUser(harness.db, { roles: ['user', 'admin'] });
    await setFreeze(harness.db, 'withdrawals', true, {
      actorUserId: admin.id,
      reason: 'X',
    });
    expect(await isFrozen(harness.db, 'withdrawals')).toBe(true);

    await setFreeze(harness.db, 'withdrawals', false, {
      actorUserId: admin.id,
      reason: 'cleared',
    });
    expect(await isFrozen(harness.db, 'withdrawals')).toBe(false);
  });
});
