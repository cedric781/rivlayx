import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bets as betEngine, marketplace } from '@rivlayx/core';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';
import { parseMarketplaceParams } from '@/lib/marketplace/params';
import { buildOpenBetInput } from '@/lib/bets/open-bet';

export const dynamic = 'force-dynamic';

/**
 * Public marketplace listing. Read-only over OPEN, not-yet-expired bets with
 * search / category / resolve-type / stake filters and section sorting.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = parseMarketplaceParams(url.searchParams);
  const db = getDb();
  const result = await marketplace.listMarketplaceBets(db, params);
  return NextResponse.json(result);
}

/** Create-bet (Sprint 26) — closed-alpha open-bet body. */
const CreateBody = z.object({
  title: z.string().trim().min(1).max(280),
  stakeUsdc: z.string().trim().regex(/^\d+(\.\d{1,6})?$/, 'stake must be a USDC amount'),
  creatorSide: z.string().trim().min(1).max(64),
  expiresAt: z.string().datetime(),
  resolvesBy: z.string().datetime(),
});

/** Map a bet-engine error code to an HTTP status (mirrors the accept route). */
const STATUS_BY_CODE: Record<string, number> = {
  SUBJECTIVE_LANGUAGE: 422,
  UNKNOWN_PREDICATE: 422,
  STAKE_TOO_LARGE: 422,
  INVALID_INPUT: 400,
  INVALID_SIDE: 400,
  INVALID_EXPIRES_AT: 400,
  INVALID_RESOLVE_CONFIG: 400,
  INVALID_ARBITER: 400,
  INSUFFICIENT_BALANCE: 402,
  NOT_AUTHORIZED: 403,
  NOT_FOUND: 404,
  FROZEN: 503,
};

/**
 * Create an OPEN bet. Thin HTTP wrapper: authenticate, validate the body shape,
 * map the closed-alpha open-bet fields to a `createBet` input, and surface
 * engine errors as HTTP statuses. All business rules (objective phrasing, stake
 * cap, freeze, balance, escrow lock, OPEN transition) live in `createBet`.
 */
export async function POST(request: Request) {
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });

  const json: unknown = await request.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'title, stake, side, expiry and resolvesBy are required' } },
      { status: 400 },
    );
  }

  const input = buildOpenBetInput(user.id, parsed.data);

  try {
    const result = await betEngine.createBet(getDb(), input);
    return NextResponse.json(
      {
        bet: { id: result.bet.id, shortCode: result.bet.shortCode, status: result.bet.status },
        shareSlug: result.shareSlug,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof betEngine.BetError) {
      const status = STATUS_BY_CODE[err.code] ?? 400;
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
    }
    throw err;
  }
}
