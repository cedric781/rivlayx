import './globals.css';
import type { ReactNode } from 'react';
import { getEnv } from '@/lib/env';
import { PrivyProviders } from '@/components/auth/privy-providers';
import { SiteFooter } from '@/components/site-footer';
import { ToastProvider } from '@/components/toast/toast-provider';

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
        fontFamily: 'var(--rx-font-sans)',
        margin: 0,
        background: 'var(--rx-color-bg)',
        color: 'var(--rx-color-text)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ToastProvider>
        <div style={{ flex: 1 }}>
          {clientAppId ? (
            <PrivyProviders appId={clientAppId} network={env.SOLANA_NETWORK} solanaRpcUrl={rpcUrl}>
              {children}
            </PrivyProviders>
          ) : (
            children
          )}
        </div>
      </ToastProvider>
      <SiteFooter />
    </body>
  );

  return <html lang="en">{body}</html>;
}
