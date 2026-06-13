import { createHash } from 'node:crypto';
import type { AuthProvider, LoginInput, LoginResult, VerifiedIdentity } from '../provider';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOCK_TOKEN_PREFIX = 'mock:';

/**
 * Development-only provider. Accepts any well-formed email and synthesises a
 * deterministic Privy-like identity. Never enable in production — the
 * `verify()` step performs no cryptographic check.
 */
export class MockAuthProvider implements AuthProvider {
  readonly name = 'mock';

  async login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new Error('Invalid email');
    }
    return Promise.resolve({ token: `${MOCK_TOKEN_PREFIX}${email}` });
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    if (!token.startsWith(MOCK_TOKEN_PREFIX)) {
      throw new Error('Invalid mock token');
    }
    const email = token.slice(MOCK_TOKEN_PREFIX.length);
    if (!EMAIL_RE.test(email)) {
      throw new Error('Invalid email in mock token');
    }
    const hash = createHash('sha256').update(email).digest('hex');
    return Promise.resolve({
      externalId: `mock_${hash.slice(0, 16)}`,
      email,
      walletAddress: `Mock${hash.slice(0, 40)}`,
      walletSource: 'mock_dev',
    });
  }
}
