import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';
import { WithdrawalError, requestWithdrawal } from '@/lib/withdrawals/request';
import { getWithdrawalLimits } from '@/lib/withdrawals/limits';

export const dynamic = 'force-dynamic';

const Body = z.object({
  amountUsdc: z.string().trim().min(1).max(32),
  destinationWallet: z.string().trim().min(32).max(64),
});

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  AMOUNT_EXCEEDS_CAP: 400,
  INSUFFICIENT_BALANCE: 402,
  OPEN_REQUEST_EXISTS: 409,
  FROZEN: 503,
  NO_WALLET: 400,
};

/**
 * Submit a withdrawal REQUEST (Sprint 30). Authenticates, validates the body,
 * and delegates to `requestWithdrawal` (freeze + balance check → persist
 * `pending_review`). No money moves; an admin fulfils it later.
 */
export async function POST(request: Request) {
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });

  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'amount and destination wallet are required' } },
      { status: 400 },
    );
  }

  try {
    const req = await requestWithdrawal(getDb(), {
      userId: user.id,
      amountUsdc: parsed.data.amountUsdc,
      destinationWallet: parsed.data.destinationWallet,
      maxWithdrawUsdc: getWithdrawalLimits().maxWithdrawUsdc,
    });
    return NextResponse.json(
      {
        request: {
          id: req.id,
          amountUsdc: req.amountUsdc,
          destinationWallet: req.destinationWallet,
          status: req.status,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof WithdrawalError) {
      const status = STATUS_BY_CODE[err.code] ?? 400;
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
    }
    throw err;
  }
}
