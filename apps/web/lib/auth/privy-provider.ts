import type { AuthProvider, LoginInput, LoginResult, VerifiedIdentity } from '@rivlayx/auth';

/**
 * Narrow surface of the Privy server SDK that we actually use. Tests inject
 * a stub matching this shape; in production the real `PrivyClient` from
 * `@privy-io/server-auth` is wired in.
 */
export interface PrivyClientLike {
  verifyAuthToken(token: string): Promise<{ userId: string; appId?: string }>;
  getUserById(userId: string): Promise<PrivyUserLike>;
}

export interface PrivyUserLike {
  id: string;
  email?: { address: string } | null;
  linkedAccounts?: ReadonlyArray<PrivyLinkedAccount>;
}

export interface PrivyLinkedAccount {
  type: string;
  address?: string;
  chainType?: string;
  walletClientType?: string;
  /** True when this embedded wallet has Privy delegated-signing granted. */
  delegated?: boolean;
}

export interface CreatePrivyAuthProviderConfig {
  appId: string;
  appSecret: string;
  /** Provide a stub PrivyClient for tests; omit in production. */
  client?: PrivyClientLike;
}

class PrivyAuthProviderImpl implements AuthProvider {
  readonly name = 'privy';
  constructor(private readonly client: PrivyClientLike) {}

  login(_input: LoginInput): Promise<LoginResult> {
    // Privy authentication happens client-side via `@privy-io/react-auth`.
    // The server only verifies tokens — calling `login` here is a programming
    // error rather than a recoverable runtime case.
    return Promise.reject(
      new Error('PrivyAuthProvider does not support server-side login; use the client SDK'),
    );
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const verified = await this.client.verifyAuthToken(token);
    const user = await this.client.getUserById(verified.userId);

    const solanaWallet = user.linkedAccounts?.find(
      (acc) => acc.type === 'wallet' && acc.chainType === 'solana' && acc.address,
    );
    if (!solanaWallet?.address) {
      throw new Error('No Solana wallet linked to Privy account');
    }

    const email = user.email?.address ?? '';

    return {
      externalId: verified.userId,
      email,
      walletAddress: solanaWallet.address,
      walletSource: 'privy_embedded',
      delegated: solanaWallet.delegated ?? false,
    };
  }
}

/**
 * Async factory — dynamically imports `@privy-io/server-auth` so the bundle
 * loads it only when real Privy is enabled. Tests pass a stub `client` and
 * skip the import entirely.
 */
export async function createPrivyAuthProvider(
  config: CreatePrivyAuthProviderConfig,
): Promise<AuthProvider> {
  if (config.client) {
    return new PrivyAuthProviderImpl(config.client);
  }
  const mod = (await import('@privy-io/server-auth')) as {
    PrivyClient: new (appId: string, appSecret: string) => PrivyClientLike;
  };
  const client = new mod.PrivyClient(config.appId, config.appSecret);
  return new PrivyAuthProviderImpl(client);
}
