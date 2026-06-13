import { describe, expect, it } from 'vitest';
import { computeHeliusSignature, verifyHeliusSignature } from './verify';

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
