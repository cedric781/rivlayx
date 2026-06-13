import type { ReactNode } from 'react';
import { getEnv } from '@/lib/env';
import { PrivyProviders } from '@/components/auth/privy-providers';

export const metadata = {
  title: 'RivlayX',
  description: 'Crypto-native objective wagering on Solana / USDC',
};

const DEFAULT_RPC: Record<'devnet' | 'mainnet-beta', string> = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const env = getEnv();
  const clientAppId = env.NEXT_PUBLIC_PRIVY_APP_ID ?? env.PRIVY_APP_ID;
  const rpcUrl = env.SOLANA_RPC_URL ?? DEFAULT_RPC[env.SOLANA_NETWORK];
  const body = (
    <body
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        margin: 0,
        background: '#0b0d10',
        color: '#e6e8eb',
        minHeight: '100vh',
      }}
    >
      {clientAppId ? (
        <PrivyProviders appId={clientAppId} network={env.SOLANA_NETWORK} solanaRpcUrl={rpcUrl}>
          {children}
        </PrivyProviders>
      ) : (
        children
      )}
    </body>
  );

  return <html lang="en">{body}</html>;
}
