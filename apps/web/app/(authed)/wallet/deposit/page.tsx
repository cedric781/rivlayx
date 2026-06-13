import Link from 'next/link';
import { requireSession } from '@rivlayx/auth/next';
import { deposits as coreDeposits } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { DepositInstructions } from '@/components/wallet/deposit-instructions';
import { DevnetWarning } from '@/components/wallet/devnet-warning';

export const metadata = { title: 'Deposit USDC — RivlayX' };

export default async function DepositPage() {
  const env = getEnv();
  await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const currentTvl = await coreDeposits.computeCurrentTvl(getDb());

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/wallet" style={{ color: '#5b8def', fontSize: 13 }}>
          ← Back to wallet
        </Link>
      </div>

      <h1>Deposit USDC</h1>
      <DevnetWarning network={env.SOLANA_NETWORK} />

      {env.PLATFORM_VAULT_ATA ? (
        <DepositInstructions
          vaultAta={env.PLATFORM_VAULT_ATA}
          network={env.SOLANA_NETWORK}
          minDepositUsdc={env.MIN_DEPOSIT_USDC}
          maxSingleDepositUsdc={env.MAX_SINGLE_DEPOSIT_USDC}
          maxTvlUsdc={env.MAX_TVL_USDC}
          currentTvlUsdc={currentTvl}
        />
      ) : (
        <div
          role="alert"
          style={{
            background: '#3a0d0d',
            color: '#ff6b6b',
            padding: '1rem',
            borderRadius: 6,
            border: '1px solid #5c1a1a',
            fontSize: 14,
          }}
        >
          <strong>Vault not configured.</strong> Set <code>PLATFORM_VAULT_ATA</code> in env to
          enable deposits.
        </div>
      )}
    </main>
  );
}
