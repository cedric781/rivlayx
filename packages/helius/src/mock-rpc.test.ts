import { describe, expect, it } from 'vitest';
import { MockHeliusRpc } from './mock-rpc';

describe('MockHeliusRpc', () => {
  it('returns null for unknown signature', async () => {
    const rpc = new MockHeliusRpc();
    expect(await rpc.getSignatureStatus('unknown')).toBeNull();
  });

  it('returns set status', async () => {
    const rpc = new MockHeliusRpc();
    rpc.setSignatureStatus('sig1', {
      signature: 'sig1',
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: 12345,
      err: null,
    });
    const status = await rpc.getSignatureStatus('sig1');
    expect(status?.confirmationStatus).toBe('finalized');
  });

  it('returns zero balance for unknown address', async () => {
    const rpc = new MockHeliusRpc();
    const bal = await rpc.getTokenAccountBalance('unknown');
    expect(bal.uiAmountString).toBe('0');
    expect(bal.amount).toBe('0');
  });

  it('returns set balance', async () => {
    const rpc = new MockHeliusRpc();
    rpc.setTokenAccountBalance('vault', {
      amount: '50000000',
      decimals: 6,
      uiAmount: 50,
      uiAmountString: '50',
    });
    const bal = await rpc.getTokenAccountBalance('vault');
    expect(bal.uiAmountString).toBe('50');
  });

  it('returns empty array for unknown address signatures', async () => {
    const rpc = new MockHeliusRpc();
    expect(await rpc.getSignaturesForAddress('unknown')).toEqual([]);
  });

  it('paginates signatures with limit', async () => {
    const rpc = new MockHeliusRpc();
    rpc.setSignaturesForAddress('vault', [
      { signature: 's1', slot: 1, blockTime: 1 },
      { signature: 's2', slot: 2, blockTime: 2 },
      { signature: 's3', slot: 3, blockTime: 3 },
    ]);
    const result = await rpc.getSignaturesForAddress('vault', { limit: 2 });
    expect(result.map((s) => s.signature)).toEqual(['s1', 's2']);
  });

  it('paginates signatures with before cursor', async () => {
    const rpc = new MockHeliusRpc();
    rpc.setSignaturesForAddress('vault', [
      { signature: 's1', slot: 1, blockTime: 1 },
      { signature: 's2', slot: 2, blockTime: 2 },
      { signature: 's3', slot: 3, blockTime: 3 },
    ]);
    const result = await rpc.getSignaturesForAddress('vault', { before: 's1' });
    expect(result.map((s) => s.signature)).toEqual(['s2', 's3']);
  });

  it('clearAll wipes all state', async () => {
    const rpc = new MockHeliusRpc();
    rpc.setSignatureStatus('sig', {
      signature: 'sig',
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: 1,
      err: null,
    });
    rpc.clearAll();
    expect(await rpc.getSignatureStatus('sig')).toBeNull();
  });
});
