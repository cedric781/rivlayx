import { describe, expect, it } from 'vitest';
import { checkCronAuth } from './cron-auth';

const SECRET = 'cron-secret-0123456789abcdef';

describe('checkCronAuth', () => {
  it('accepts a matching bearer token', () => {
    const d = checkCronAuth({
      authHeader: `Bearer ${SECRET}`,
      expectedSecret: SECRET,
      isProduction: true,
    });
    expect(d.ok).toBe(true);
  });

  it('rejects a wrong token with 401', () => {
    const d = checkCronAuth({
      authHeader: 'Bearer nope',
      expectedSecret: SECRET,
      isProduction: true,
    });
    expect(d).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a missing header with 401', () => {
    const d = checkCronAuth({ authHeader: null, expectedSecret: SECRET, isProduction: true });
    expect(d).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a non-Bearer scheme with 401', () => {
    const d = checkCronAuth({
      authHeader: SECRET,
      expectedSecret: SECRET,
      isProduction: true,
    });
    expect(d).toMatchObject({ ok: false, status: 401 });
  });

  it('allows when secret unset in non-production', () => {
    const d = checkCronAuth({ authHeader: null, expectedSecret: undefined, isProduction: false });
    expect(d.ok).toBe(true);
  });

  it('refuses with 503 when secret unset in production', () => {
    const d = checkCronAuth({ authHeader: null, expectedSecret: undefined, isProduction: true });
    expect(d).toMatchObject({ ok: false, status: 503, code: 'CRON_DISABLED' });
  });
});
