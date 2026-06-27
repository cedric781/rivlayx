import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for B1: the admin login route must perform real first-factor
 * credential verification and must NOT reach the dev-only email-only
 * MockAuthProvider. A source-level assertion keeps a future refactor from
 * silently reintroducing the bypass.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ROUTE = resolve(here, '..', '..', 'app', 'api', 'auth', 'login', 'route.ts');
const source = readFileSync(ROUTE, 'utf-8');

describe('admin login route — B1 first-factor guard', () => {
  it('does not reference MockAuthProvider (mock provider unavailable)', () => {
    expect(source).not.toMatch(/MockAuthProvider/);
  });

  it('verifies real credentials via verifyAdminCredentials', () => {
    expect(source).toMatch(/verifyAdminCredentials/);
  });

  it('requires a password in the request body (no email-only login)', () => {
    // The zod body schema must demand a non-empty password alongside email.
    expect(source).toMatch(/password:\s*z\.string\(\)\.min\(1\)/);
    expect(source).toMatch(/email:\s*z\.string\(\)\.email\(\)/);
  });
});
