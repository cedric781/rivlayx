import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealHeliusRpc } from './real-rpc';

const RPC_URL = 'https://rpc.test/solana';

/** Stub the global fetch with a single JSON-RPC response (or a thrown error). */
function mockFetch(impl: (body: { method: string; params: unknown[] }) => unknown) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    const outcome = impl(parsed);
    if (outcome instanceof Error) throw outcome;
    return new Response(JSON.stringify(outcome), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RealHeliusRpc.getSignatureStatus', () => {
  it('requests getSignatureStatuses with searchTransactionHistory: true', async () => {
    const fetchSpy = mockFetch((body) => {
      expect(body.method).toBe('getSignatureStatuses');
      expect(body.params[0]).toEqual(['sig1']);
      expect(body.params[1]).toEqual({ searchTransactionHistory: true });
      return { result: { value: [{ confirmationStatus: 'finalized', confirmations: null, slot: 1, err: null }] } };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const rpc = new RealHeliusRpc(RPC_URL);
    const status = await rpc.getSignatureStatus('sig1');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(status).toEqual({
      signature: 'sig1',
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: 1,
      err: null,
    });
  });

  it('maps a confirmed (non-finalized) status', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({
      result: { value: [{ confirmationStatus: 'confirmed', confirmations: 12, slot: 7, err: null }] },
    })));
    const status = await new RealHeliusRpc(RPC_URL).getSignatureStatus('sig');
    expect(status?.confirmationStatus).toBe('confirmed');
    expect(status?.confirmations).toBe(12);
  });

  it('maps a processed status', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({
      result: { value: [{ confirmationStatus: 'processed', confirmations: 1, slot: 7, err: null }] },
    })));
    const status = await new RealHeliusRpc(RPC_URL).getSignatureStatus('sig');
    expect(status?.confirmationStatus).toBe('processed');
  });

  it('returns null for an unknown signature (value[0] === null)', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ result: { value: [null] } })));
    const status = await new RealHeliusRpc(RPC_URL).getSignatureStatus('missing');
    expect(status).toBeNull();
  });

  it('surfaces a tx error object', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({
      result: { value: [{ confirmationStatus: 'finalized', confirmations: null, slot: 7, err: { InstructionError: [0, 'X'] } }] },
    })));
    const status = await new RealHeliusRpc(RPC_URL).getSignatureStatus('sig');
    expect(status?.err).toEqual({ InstructionError: [0, 'X'] });
  });

  it('defaults a missing confirmationStatus to null', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({
      result: { value: [{ confirmations: 5, slot: 7, err: null }] },
    })));
    const status = await new RealHeliusRpc(RPC_URL).getSignatureStatus('sig');
    expect(status?.confirmationStatus).toBeNull();
  });

  it('throws on an HTTP non-200 (never a fabricated status)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(new RealHeliusRpc(RPC_URL).getSignatureStatus('sig')).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a JSON-RPC error body', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ error: { code: -32000, message: 'node behind' } })));
    await expect(new RealHeliusRpc(RPC_URL).getSignatureStatus('sig')).rejects.toThrow(/node behind/);
  });

  it('throws on a transport/timeout failure', async () => {
    vi.stubGlobal('fetch', mockFetch(() => new Error('AbortError: timeout')));
    await expect(new RealHeliusRpc(RPC_URL).getSignatureStatus('sig')).rejects.toThrow(/request failed/);
  });
});

describe('RealHeliusRpc.getTokenAccountBalance', () => {
  it('maps the balance value', async () => {
    vi.stubGlobal('fetch', mockFetch((body) => {
      expect(body.method).toBe('getTokenAccountBalance');
      return { result: { value: { amount: '1500000', decimals: 6, uiAmount: 1.5, uiAmountString: '1.5' } } };
    }));
    const bal = await new RealHeliusRpc(RPC_URL).getTokenAccountBalance('Vault111');
    expect(bal).toEqual({ amount: '1500000', decimals: 6, uiAmount: 1.5, uiAmountString: '1.5' });
  });

  it('throws on RPC failure (no fabricated balance)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    await expect(new RealHeliusRpc(RPC_URL).getTokenAccountBalance('Vault111')).rejects.toThrow(/HTTP 503/);
  });
});

describe('RealHeliusRpc.getSignaturesForAddress', () => {
  it('maps signatures and forwards pagination options', async () => {
    vi.stubGlobal('fetch', mockFetch((body) => {
      expect(body.method).toBe('getSignaturesForAddress');
      expect(body.params[1]).toEqual({ limit: 2, before: 'b' });
      return { result: [{ signature: 's1', slot: 1, blockTime: 100 }, { signature: 's2', slot: 2, blockTime: null }] };
    }));
    const sigs = await new RealHeliusRpc(RPC_URL).getSignaturesForAddress('Addr', { limit: 2, before: 'b' });
    expect(sigs).toEqual([
      { signature: 's1', slot: 1, blockTime: 100 },
      { signature: 's2', slot: 2, blockTime: null },
    ]);
  });
});

describe('constructor', () => {
  it('rejects an empty rpcUrl', () => {
    expect(() => new RealHeliusRpc('')).toThrow(/non-empty/);
  });
});
