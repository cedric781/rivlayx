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
