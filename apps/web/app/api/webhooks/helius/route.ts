import { NextResponse } from 'next/server';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import {
  ParseError,
  isHeliusWebhookAuthorized,
  parseSplTransfer,
  webhookEnvelopeSchema,
} from '@rivlayx/helius';
import { deposits as coreDeposits } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Header carrying the HMAC-SHA256 hex signature of the raw body. */
const SIGNATURE_HEADER = 'x-helius-signature';
/** Helius's native webhook auth sends a static bearer via this header. */
const AUTH_HEADER = 'authorization';
const DEV_VAULT_ATA_FALLBACK = 'DevVaultAta11111111111111111111111111111111';

/**
 * Real deposit ingress (Sprint 30; C6C: detect-only). Receives a Helius enhanced
 * TOKEN_TRANSFER webhook batch, authenticates it (HMAC-SHA256 over the raw body
 * OR a matching bearer), then runs each transfer through DETECTION only:
 *
 *   parseSplTransfer → detectDeposit  (→ persist a `pending` row, or orphan/duplicate)
 *
 * It does NOT confirm, credit, or move any balance. Finality is never trusted
 * from webhook delivery — crediting happens exclusively in the deposit poller
 * (`/api/cron/deposits`) after independent `finalized` RPC verification. Dedup on
 * `tx_signature` makes webhook retries / replays a no-op.
 */
export async function POST(request: Request) {
  const env = getEnv();
  const secret = env.HELIUS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'Webhook ingress not configured' } },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  // Accept EITHER a valid x-helius-signature HMAC over the raw body OR a
  // matching `Authorization: Bearer <HELIUS_WEBHOOK_SECRET>`. Both checks are
  // constant-time; neither valid → 401. The secret is never logged.
  const authorized = isHeliusWebhookAuthorized({
    secret,
    rawBody,
    signatureHeader: request.headers.get(SIGNATURE_HEADER),
    authHeader: request.headers.get(AUTH_HEADER),
  });
  if (!authorized) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid webhook authentication' } },
      { status: 401 },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Body is not valid JSON' } },
      { status: 400 },
    );
  }
  const parsed = webhookEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Unexpected webhook payload shape' } },
      { status: 400 },
    );
  }

  const db = getDb();
  const vaultAta = env.PLATFORM_VAULT_ATA ?? DEV_VAULT_ATA_FALLBACK;
  const config = {
    minDepositUsdc: String(env.MIN_DEPOSIT_USDC),
    maxSingleDepositUsdc: String(env.MAX_SINGLE_DEPOSIT_USDC),
    maxTvlUsdc: String(env.MAX_TVL_USDC),
    expectedDestAta: vaultAta,
  };

  const result = { received: parsed.data.length, detected: 0, rejected: 0, orphan: 0, duplicate: 0, skipped: 0 };
  const outcomes: Array<{ signature: string; stage: string; kind: string }> = [];

  for (const event of parsed.data) {
    let transfer;
    try {
      transfer = parseSplTransfer(event, {
        expectedMint: USDC_MINT_ADDRESS,
        expectedDestAta: vaultAta,
      });
    } catch (err) {
      // Transfers not to our vault / wrong mint are not deposits — skip quietly.
      result.skipped += 1;
      outcomes.push({
        signature: event.signature,
        stage: 'parse',
        kind: err instanceof ParseError ? err.code : 'parse_error',
      });
      continue;
    }

    // Detect-only: persist a pending row (or orphan / rejected), dedup on
    // tx_signature. NO confirm, NO credit — the poller does that after finality.
    const detect = await coreDeposits.detectDeposit(db, transfer, config, event);
    if (detect.kind === 'deposit') result.detected += 1;
    else if (detect.kind === 'deposit_rejected') result.rejected += 1;
    else if (detect.kind === 'orphan') result.orphan += 1;
    else if (detect.kind === 'duplicate') result.duplicate += 1;
    outcomes.push({ signature: transfer.signature, stage: 'detect', kind: detect.kind });
  }

  return NextResponse.json({ ok: true, ...result, outcomes });
}
