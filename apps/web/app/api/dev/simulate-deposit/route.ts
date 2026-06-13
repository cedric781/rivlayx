import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { MockHeliusRpc, buildMockTokenTransfer, parseSplTransfer } from '@rivlayx/helius';
import { deposits as coreDeposits } from '@rivlayx/core';
import { wallets } from '@rivlayx/db';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

const Body = z.object({
  sourceWallet: z.string().min(32).max(64).optional(),
  amountUsdc: z.coerce.number().positive(),
  signature: z.string().min(40).max(128).optional(),
});

const DEV_VAULT_ATA_FALLBACK = 'DevVaultAta11111111111111111111111111111111';

/**
 * Manual deposit-flow trigger for local + devnet UX testing. Builds a mock
 * Helius TOKEN_TRANSFER event, runs it through detect → confirm → credit
 * using `MockHeliusRpc` (no live RPC). Only available outside production.
 *
 * If `sourceWallet` is omitted, defaults to the signed-in user's primary
 * wallet so the deposit attributes to them (no orphan).
 */
export async function POST(request: Request) {
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Dev simulator is disabled in production' } },
      { status: 404 },
    );
  }

  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });

  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'amountUsdc required' } },
      { status: 400 },
    );
  }

  const db = getDb();
  let sourceWallet = parsed.data.sourceWallet;
  if (!sourceWallet) {
    const [w] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!w) {
      return NextResponse.json(
        { error: { code: 'NO_WALLET', message: 'No primary wallet linked' } },
        { status: 400 },
      );
    }
    sourceWallet = w.address;
  }

  const vaultAta = env.PLATFORM_VAULT_ATA ?? DEV_VAULT_ATA_FALLBACK;
  const event = buildMockTokenTransfer({
    sourceWallet,
    destAta: vaultAta,
    amountUsdc: parsed.data.amountUsdc,
    signature: parsed.data.signature,
  });
  const transfer = parseSplTransfer(event, {
    expectedMint: USDC_MINT_ADDRESS,
    expectedDestAta: vaultAta,
  });

  const config = {
    minDepositUsdc: String(env.MIN_DEPOSIT_USDC),
    maxSingleDepositUsdc: String(env.MAX_SINGLE_DEPOSIT_USDC),
    maxTvlUsdc: String(env.MAX_TVL_USDC),
    expectedDestAta: vaultAta,
  };

  const detect = await coreDeposits.detectDeposit(db, transfer, config, event);
  if (detect.kind !== 'deposit') {
    return NextResponse.json({ stage: 'detect', result: detect });
  }

  const rpc = new MockHeliusRpc();
  rpc.setSignatureStatus(transfer.signature, {
    signature: transfer.signature,
    confirmationStatus: 'finalized',
    confirmations: null,
    slot: transfer.slot,
    err: null,
  });

  const confirm = await coreDeposits.confirmDeposit(db, rpc, detect.depositId);
  if (confirm.kind !== 'confirmed') {
    return NextResponse.json({ stage: 'confirm', result: confirm });
  }

  const credit = await coreDeposits.creditDeposit(db, detect.depositId);
  return NextResponse.json({ stage: 'credit', result: credit });
}
