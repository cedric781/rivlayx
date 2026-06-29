import { describe, expect, it } from 'vitest';
import {
  computeHeliusSignature,
  isHeliusWebhookAuthorized,
  verifyHeliusBearer,
  verifyHeliusSignature,
} from './verify';

const SECRET = 'shhh-this-is-a-test-secret-do-not-use-in-prod';

describe('verifyHeliusSignature', () => {
  it('accepts a signature it generated', () => {
    const body = JSON.stringify({ events: [{ signature: 'abc', amount: 1.23 }] });
    const sig = computeHeliusSignature(SECRET, body);
    expect(verifyHeliusSignature(SECRET, body, sig)).toBe(true);
  });

  it('rejects signature with wrong secret', () => {
    const body = '{}';
    const sig = computeHeliusSignature(SECRET, body);
    expect(verifyHeliusSignature('different-secret', body, sig)).toBe(false);
  });

  it('rejects signature with modified body', () => {
    const body = '{"a":1}';
    const sig = computeHeliusSignature(SECRET, body);
    expect(verifyHeliusSignature(SECRET, '{"a":2}', sig)).toBe(false);
  });

  it('rejects malformed hex signature', () => {
    expect(verifyHeliusSignature(SECRET, 'body', 'not-hex-zzzz')).toBe(false);
  });

  it('rejects truncated signature', () => {
    const body = '{}';
    const sig = computeHeliusSignature(SECRET, body);
    expect(verifyHeliusSignature(SECRET, body, sig.slice(0, sig.length - 2))).toBe(false);
  });

  it('rejects empty signature', () => {
    expect(verifyHeliusSignature(SECRET, 'body', '')).toBe(false);
  });
});

describe('computeHeliusSignature', () => {
  it('is deterministic for same input', () => {
    const body = '{"a":1}';
    expect(computeHeliusSignature(SECRET, body)).toBe(computeHeliusSignature(SECRET, body));
  });

  it('produces a 64-char hex digest', () => {
    expect(computeHeliusSignature(SECRET, '{}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs on different secrets', () => {
    const body = '{}';
    expect(computeHeliusSignature('a', body)).not.toBe(computeHeliusSignature('b', body));
  });
});

describe('verifyHeliusBearer', () => {
  it('accepts a correct Bearer token (happy path)', () => {
    expect(verifyHeliusBearer(SECRET, `Bearer ${SECRET}`)).toBe(true);
  });

  it('rejects a wrong Bearer token', () => {
    expect(verifyHeliusBearer(SECRET, 'Bearer wrong-token-of-some-length')).toBe(false);
  });

  it('rejects a token of different length (no partial match)', () => {
    expect(verifyHeliusBearer(SECRET, `Bearer ${SECRET}extra`)).toBe(false);
  });

  it('rejects a missing or empty header', () => {
    expect(verifyHeliusBearer(SECRET, null)).toBe(false);
    expect(verifyHeliusBearer(SECRET, undefined)).toBe(false);
    expect(verifyHeliusBearer(SECRET, '')).toBe(false);
  });

  it('rejects a non-Bearer scheme even with the right value', () => {
    expect(verifyHeliusBearer(SECRET, SECRET)).toBe(false);
    expect(verifyHeliusBearer(SECRET, `Basic ${SECRET}`)).toBe(false);
  });

  it('rejects an empty Bearer token', () => {
    expect(verifyHeliusBearer(SECRET, 'Bearer ')).toBe(false);
  });

  it('rejects when the configured secret is empty (no open path)', () => {
    expect(verifyHeliusBearer('', 'Bearer ')).toBe(false);
  });
});

describe('isHeliusWebhookAuthorized', () => {
  const body = JSON.stringify({ events: [{ signature: 'abc' }] });
  const goodSig = computeHeliusSignature(SECRET, body);

  it('authorizes a valid HMAC signature (no bearer present)', () => {
    expect(
      isHeliusWebhookAuthorized({ secret: SECRET, rawBody: body, signatureHeader: goodSig, authHeader: null }),
    ).toBe(true);
  });

  it('authorizes a valid Bearer (no/invalid signature present)', () => {
    expect(
      isHeliusWebhookAuthorized({
        secret: SECRET,
        rawBody: body,
        signatureHeader: null,
        authHeader: `Bearer ${SECRET}`,
      }),
    ).toBe(true);
  });

  it('authorizes a valid Bearer even if the signature header is garbage', () => {
    expect(
      isHeliusWebhookAuthorized({
        secret: SECRET,
        rawBody: body,
        signatureHeader: 'not-a-valid-sig',
        authHeader: `Bearer ${SECRET}`,
      }),
    ).toBe(true);
  });

  it('rejects when neither scheme is valid', () => {
    expect(
      isHeliusWebhookAuthorized({
        secret: SECRET,
        rawBody: body,
        signatureHeader: 'bad-sig',
        authHeader: 'Bearer bad-token',
      }),
    ).toBe(false);
  });

  it('rejects when both headers are absent', () => {
    expect(
      isHeliusWebhookAuthorized({ secret: SECRET, rawBody: body, signatureHeader: null, authHeader: null }),
    ).toBe(false);
  });

  it('does not let a tampered body pass via the bearer path leaking into HMAC', () => {
    // Bearer is body-independent (correct), but a wrong bearer + wrong sig must fail.
    expect(
      isHeliusWebhookAuthorized({
        secret: SECRET,
        rawBody: '{"tampered":true}',
        signatureHeader: goodSig, // computed for the ORIGINAL body → invalid here
        authHeader: 'Bearer nope',
      }),
    ).toBe(false);
  });
});
