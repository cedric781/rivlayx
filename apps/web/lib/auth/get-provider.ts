import { MockAuthProvider, type AuthProvider } from '@rivlayx/auth';
import { getEnv } from '@/lib/env';

let cached: Promise<AuthProvider> | null = null;

/**
 * Resolve the active auth provider:
 *
 *   - Real `PrivyAuthProvider` when `PRIVY_APP_ID` + `PRIVY_APP_SECRET` are set.
 *   - `MockAuthProvider` otherwise (CI, local dev without Privy keys).
 *
 * Cached across calls so the Privy client + transitive imports load at most
 * once per process.
 */
export function getAuthProvider(): Promise<AuthProvider> {
  if (cached) return cached;
  const env = getEnv();
  if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET) {
    cached = import('./privy-provider').then(({ createPrivyAuthProvider }) =>
      createPrivyAuthProvider({
        appId: env.PRIVY_APP_ID!,
        appSecret: env.PRIVY_APP_SECRET!,
      }),
    );
  } else {
    cached = Promise.resolve(new MockAuthProvider());
  }
  return cached;
}

/**
 * Internal helper for tests — reset the cached provider between cases so a
 * different env can be exercised.
 */
export function _resetAuthProviderCache(): void {
  cached = null;
}
