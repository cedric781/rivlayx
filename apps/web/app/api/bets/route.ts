import { NextResponse } from 'next/server';
import { marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { parseMarketplaceParams } from '@/lib/marketplace/params';

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
