import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '@rivlayx/test-utils';
import { withAdvisoryLock, CRON_LOCK_KEYS } from './advisory-lock';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});

describe('CRON_LOCK_KEYS', () => {
  it('defines a unique deposits key distinct from every other cycle', () => {
    expect(CRON_LOCK_KEYS.deposits).toBe(920_008);
    const values = Object.values(CRON_LOCK_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('withAdvisoryLock', () => {
  it('acquires the lock, runs fn, and returns its result', async () => {
    const r = await withAdvisoryLock(harness.db, CRON_LOCK_KEYS.settle, async () => 'done');
    expect(r.ran).toBe(true);
    expect(r.result).toBe('done');
  });

  it('releases the lock even when fn throws, so it can be re-acquired', async () => {
    await expect(
      withAdvisoryLock(harness.db, CRON_LOCK_KEYS.recon, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If the lock were still held, this second acquisition would block/fail.
    const r = await withAdvisoryLock(harness.db, CRON_LOCK_KEYS.recon, async () => 42);
    expect(r.ran).toBe(true);
    expect(r.result).toBe(42);
  });
});
