import { NextResponse } from 'next/server';
import { marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Public bet detail, resolvable by UUID, short code, or share-link slug.
 * 404 for unknown or DRAFT bets.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const detail = await marketplace.getMarketplaceBet(db, id);
  if (!detail) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Bet not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json(detail);
}
