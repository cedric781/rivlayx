import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the canonical HMAC-SHA256 signature for a Helius webhook body.
 * Returns the hex digest. Same function used to sign mocks in tests and to
 * recompute the expected signature when verifying inbound webhooks.
 */
export function computeHeliusSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time HMAC verify. Returns `false` on any error (length mismatch,
 * invalid hex, etc.) without leaking timing information.
 */
export function verifyHeliusSignature(
  secret: string,
  rawBody: string,
  providedSignature: string,
): boolean {
  const expected = computeHeliusSignature(secret, rawBody);
  const expectedBuf = Buffer.from(expected, 'hex');

  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(providedSignature, 'hex');
  } catch {
    return false;
  }

  if (expectedBuf.length === 0 || actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header against the
 * shared webhook secret. Helius's native webhook auth sends a static bearer
 * header rather than an HMAC signature, so the ingress accepts either scheme.
 * Never logs or echoes the secret.
 */
export function verifyHeliusBearer(secret: string, authHeader: string | null | undefined): boolean {
  if (!authHeader) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  const token = authHeader.slice(prefix.length);
  if (token.length === 0) return false;

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (secretBuf.length === 0 || tokenBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(tokenBuf, secretBuf);
}

export interface HeliusWebhookAuthInput {
  /** Shared `HELIUS_WEBHOOK_SECRET`. Caller must ensure it is non-empty. */
  secret: string;
  /** Raw request body — required for the HMAC scheme. */
  rawBody: string;
  /** Value of the `x-helius-signature` header, if any. */
  signatureHeader: string | null | undefined;
  /** Value of the `Authorization` header, if any. */
  authHeader: string | null | undefined;
}

/**
 * Authorize an inbound Helius webhook by EITHER a valid `x-helius-signature`
 * HMAC over the raw body, OR a matching `Authorization: Bearer <secret>`.
 *
 * Both checks are constant-time. An invalid value for one scheme does not block
 * a valid value for the other, but with neither valid the request is rejected —
 * there is no open path. Never logs or returns the secret.
 */
export function isHeliusWebhookAuthorized(input: HeliusWebhookAuthInput): boolean {
  const sigOk =
    typeof input.signatureHeader === 'string' &&
    input.signatureHeader.length > 0 &&
    verifyHeliusSignature(input.secret, input.rawBody, input.signatureHeader);
  if (sigOk) return true;
  return verifyHeliusBearer(input.secret, input.authHeader);
}
