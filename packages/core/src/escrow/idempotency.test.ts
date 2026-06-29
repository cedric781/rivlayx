import { describe, expect, it } from 'vitest';
import { transferIdempotencyKey } from './idempotency';

describe('transferIdempotencyKey (unified scheme)', () => {
  it('stake key is unique per (bet, user)', () => {
    expect(transferIdempotencyKey.stake('bet1', 'user1')).toBe('stake:bet1:user1');
  });

  it('payout key is unique per bet', () => {
    expect(transferIdempotencyKey.payout('bet1')).toBe('payout:bet1');
  });

  it('withdrawal key is unique per request', () => {
    expect(transferIdempotencyKey.withdrawal('req1')).toBe('withdrawal:req1');
  });

  it('distinct logical transfers never collide on a key', () => {
    const keys = new Set([
      transferIdempotencyKey.stake('b', 'u1'),
      transferIdempotencyKey.stake('b', 'u2'), // different staker, same bet
      transferIdempotencyKey.payout('b'),
      transferIdempotencyKey.withdrawal('b'),
    ]);
    expect(keys.size).toBe(4);
  });

  it('the same logical transfer always derives the same key (idempotent)', () => {
    expect(transferIdempotencyKey.withdrawal('req1')).toBe(transferIdempotencyKey.withdrawal('req1'));
    expect(transferIdempotencyKey.stake('b', 'u')).toBe(transferIdempotencyKey.stake('b', 'u'));
  });
});
