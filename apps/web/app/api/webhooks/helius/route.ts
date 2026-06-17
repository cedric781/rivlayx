import { NextResponse } from 'next/server';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import {
  ParseError,
  parseSplTransfer,
  verifyHeliusSignature,
  webhookEnvelopeSchema,
} from '@rivlayx/helius';
import { deposits as coreDeposits } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { WebhookFinalityRpc } from '@/lib/helius/rpc';

export const dynamic = 'force-dynamic';

/** Header carrying the HMAC-SHA256 hex signature of the raw body. */
const SIGNATURE_HEADER = 'x-helius-signature';
const DEV_VAULT_ATA_FALLBACK = 'DevVaultAta11111111111111111111111111111111';

/**
 * Real deposit ingress (Sprint 30). Receives a Helius enhanced TOKEN_TRANSFER
 * webhook batch, authenticates it (HMAC-SHA256 over the raw body), then runs
 * each transfer through the EXISTING deposit pipeline:
 *
 *   parseSplTransfer → detectDeposit → confirmDeposit → creditDeposit
 *
 * No new ledger logic — this route only authenticates, parses, and orchestrates
 * the existing engine. Confirmation trusts the finalized, authenticated webhook
 * (see WebhookFinalityRpc).
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
  const signature = request.headers.get(SIGNATURE_HEADER) ?? '';
  if (!verifyHeliusSignature(secret, rawBody, signature)) {
    return NextResponse.json(
      { error: { code: 'BAD_SIGNATURE', message: 'Invalid webhook signature' } },
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
  const rpc = new WebhookFinalityRpc();
  const vaultAta = env.PLATFORM_VAULT_ATA ?? DEV_VAULT_ATA_FALLBACK;
  const config = {
    minDepositUsdc: String(env.MIN_DEPOSIT_USDC),
    maxSingleDepositUsdc: String(env.MAX_SINGLE_DEPOSIT_USDC),
    maxTvlUsdc: String(env.MAX_TVL_USDC),
    expectedDestAta: vaultAta,
  };

  const result = { received: parsed.data.length, credited: 0, skipped: 0, pending: 0 };
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

    const detect = await coreDeposits.detectDeposit(db, transfer, config, event);
    if (detect.kind !== 'deposit') {
      result.skipped += 1;
      outcomes.push({ signature: transfer.signature, stage: 'detect', kind: detect.kind });
      continue;
    }

    const confirm = await coreDeposits.confirmDeposit(db, rpc, detect.depositId);
    if (confirm.kind !== 'confirmed') {
      result.pending += 1;
      outcomes.push({ signature: transfer.signature, stage: 'confirm', kind: confirm.kind });
      continue;
    }

    const credit = await coreDeposits.creditDeposit(db, detect.depositId);
    if (credit.kind === 'credited') result.credited += 1;
    else result.skipped += 1;
    outcomes.push({ signature: transfer.signature, stage: 'credit', kind: credit.kind });
  }

  return NextResponse.json({ ok: true, ...result, outcomes });
}
