'use client';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import type { ReactNode } from 'react';

export interface PrivyProvidersProps {
  appId: string;
  network: 'devnet' | 'mainnet-beta';
  solanaRpcUrl: string;
  children: ReactNode;
}

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

/**
 * Wrap the user-app subtree in Privy's client-side provider. Configured for
 * Solana embedded wallets only — no EVM, no external wallet adapters for
 * Fase 1. The `network` prop is passed through for the RPC cluster config.
 */
export function PrivyProviders({ appId, network, solanaRpcUrl, children }: PrivyProvidersProps) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#5b8def',
          showWalletLoginFirst: false,
        },
        loginMethods: ['email', 'google', 'twitter'],
        embeddedWallets: {
          solana: {
            createOnLogin: 'users-without-wallets',
          },
        },
        solanaClusters: [
          {
            name: network,
            rpcUrl: solanaRpcUrl,
          },
        ],
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
