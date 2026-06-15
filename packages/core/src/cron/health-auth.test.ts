import { describe, expect, it } from 'vitest';
import { checkHealthAuth } from './cron-auth';

const HEALTH = 'health-token-0123456789abcdef';
const CRON = 'cron-secret-0123456789abcdef';

describe('checkHealthAuth', () => {
  it('accepts a matching health token', () => {
    const d = checkHealthAuth({
      authHeader: `Bearer ${HEALTH}`,
      cronSecret: CRON,
      healthToken: HEALTH,
      isProduction: true,
    });
    expect(d.ok).toBe(true);
  });

  it('accepts the cron secret as an internal fallback', () => {
    const d = checkHealthAuth({
      authHeader: `Bearer ${CRON}`,
      cronSecret: CRON,
      healthToken: HEALTH,
      isProduction: true,
    });
    expect(d.ok).toBe(true);
  });

  it('accepts the health token even when no cron secret is set', () => {
    const d = checkHealthAuth({
      authHeader: `Bearer ${HEALTH}`,
      cronSecret: undefined,
      healthToken: HEALTH,
      isProduction: true,
    });
    expect(d.ok).toBe(true);
  });

  it('rejects a wrong token with 401', () => {
    const d = checkHealthAuth({
      authHeader: 'Bearer nope',
      cronSecret: CRON,
      healthToken: HEALTH,
      isProduction: true,
    });
    expect(d).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a missing header with 401', () => {
    const d = checkHealthAuth({
      authHeader: null,
      cronSecret: CRON,
      healthToken: HEALTH,
      isProduction: true,
    });
    expect(d).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a non-Bearer scheme with 401', () => {
    const d = checkHealthAuth({
      authHeader: HEALTH,
      cronSecret: undefined,
      healthToken: HEALTH,
      isProduction: true,
    });
    expect(d).toMatchObject({ ok: false, status: 401 });
  });

  it('allows when nothing configured in non-production', () => {
    const d = checkHealthAuth({
      authHeader: null,
      cronSecret: undefined,
      healthToken: undefined,
      isProduction: false,
    });
    expect(d.ok).toBe(true);
  });

  it('refuses with 503 when nothing configured in production', () => {
    const d = checkHealthAuth({
      authHeader: null,
      cronSecret: undefined,
      healthToken: undefined,
      isProduction: true,
    });
    expect(d).toMatchObject({ ok: false, status: 503, code: 'HEALTH_DISABLED' });
  });
});
