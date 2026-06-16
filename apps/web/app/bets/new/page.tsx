import { bets, ledger } from '@rivlayx/core';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';
import { CreateBetForm } from '@/components/marketplace/create-bet-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create a bet — RivlayX' };

/**
 * Create-bet screen (Sprint 26, closed alpha). Authenticated; renders the
 * five-field open-bet form with the creator's available balance so the stake
 * input can guide them before they submit.
 */
export default async function NewBetPage() {
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const balance = await ledger.getBalance(getDb(), user.id);

  return (
    <main style={{ maxWidth: 640, margin: '2.5rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: 4 }}>Create a bet</h1>
      <p style={{ marginTop: 0, opacity: 0.6, fontSize: 14 }}>
        Open a wager anyone can accept. A platform arbiter judges the outcome after your
        resolve date.
      </p>
      <CreateBetForm
        availableUsdc={balance?.availableUsdc ?? '0'}
        maxStakeUsdc={bets.BET_ENGINE_DEFAULTS.maxBetUsdc}
        creationFeeUsdc={bets.BET_ENGINE_DEFAULTS.defaultCreationFeeUsdc}
      />
    </main>
  );
}
