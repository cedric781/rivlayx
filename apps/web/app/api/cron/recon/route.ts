import { NextResponse } from 'next/server';
import { ledger, cron, ops, deposits as coreDeposits } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { requireCron } from '@/lib/auth/require-cron';
import { buildHeliusRpc } from '@/lib/helius/rpc';
import { reconcileEscrowAndEscalate } from '@/lib/recon/escrow';

type EscrowReconResult = Awaited<ReturnType<typeof reconcileEscrowAndEscalate>>;

export const dynamic = 'force-dynamic';

/**
 * Reconciliation cron (Sprint 12a; C6D: on-chain leg wired; Phase 4: escrow leg).
 *
 * Always runs internal-consistency reconciliation (Σdebit == Σcredit). When a
 * live RPC (`SOLANA_RPC_URL`) and `PLATFORM_VAULT_ATA` are configured, it also
 * compares the on-chain vault balance against the ledger's `deposit_holding`
 * view via `reconcileVault` (minus in-flight deposits). If the RPC is
 * unavailable, it falls back to internal-only so the consistency check + audit
 * row always run — an outage must not disable reconciliation.
 *
 * Phase 4 adds a READ-ONLY escrow-wallet leg: when the RPC and `ESCROW_VAULT_ATA`
 * are configured, it runs `reconcileEscrow` and escalates the same way. It moves
 * no money and starts no transfers.
 *
 * On `halt` or `drift` (either leg), escalates by freezing `settlements` +
 * `withdrawals` (system actor — null user id), per the blueprint.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const env = getEnv();
  const db = getDb();
  const rpc = buildHeliusRpc();

  const locked = await ops.recordCronRun(db, 'recon', () =>
    cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.recon, async () => {
      let result;
      if (rpc && env.PLATFORM_VAULT_ATA) {
        try {
          result = await coreDeposits.reconcileVault(db, { vaultAta: env.PLATFORM_VAULT_ATA, rpc });
        } catch {
          // RPC/on-chain leg unavailable → internal-only so the consistency
          // check + audit row still run this cycle.
          result = await ledger.runReconciliation(db);
        }
      } else {
        result = await ledger.runReconciliation(db);
      }

      if (result.status === 'halt' || result.status === 'drift') {
        const reason = `auto-freeze: reconciliation ${result.status} (drift ${result.driftUsdc})`;
        await ledger.setFreeze(db, 'settlements', true, { actorUserId: null, reason });
        await ledger.setFreeze(db, 'withdrawals', true, { actorUserId: null, reason });
      }

      // ── Escrow-wallet leg (read-only; freezes on drift/halt). Skipped when the
      // RPC or ESCROW_VAULT_ATA is unavailable so the deposit leg still completes. ──
      let escrowRecon: EscrowReconResult | null = null;
      if (rpc && env.ESCROW_VAULT_ATA) {
        try {
          escrowRecon = await reconcileEscrowAndEscalate(db, { escrowAta: env.ESCROW_VAULT_ATA, rpc });
        } catch {
          escrowRecon = null;
        }
      }

      return { recon: result, escrowRecon };
    }),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  const { recon, escrowRecon } = locked.result!;
  const ok = recon.status === 'ok' && (escrowRecon === null || escrowRecon.status === 'ok');
  const httpStatus = ok ? 200 : 503;
  return NextResponse.json({ ok, recon, escrowRecon }, { status: httpStatus });
}
