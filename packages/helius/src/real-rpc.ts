import type {
  IHeliusRpc,
  SignatureInfo,
  SignatureStatus,
  SignaturesForAddressOptions,
  TokenAccountBalance,
} from './rpc-interface';

/**
 * Live Solana JSON-RPC client (C6A). Implements the same `IHeliusRpc` surface as
 * `MockHeliusRpc`, so the deposit-confirm path is unchanged — only which client
 * is injected differs.
 *
 * Finality contract: this client never synthesizes a commitment. It returns the
 * chain's actual `confirmationStatus`, and any transport/timeout/RPC error
 * THROWS rather than returning a fabricated status — so a caller can never
 * mistake an outage for finality and credit a deposit. `confirmDeposit` gates
 * strictly on `confirmationStatus === 'finalized'`.
 */
export class RealHeliusRpc implements IHeliusRpc {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;

  constructor(rpcUrl: string, opts: { timeoutMs?: number } = {}) {
    if (!rpcUrl) throw new Error('RealHeliusRpc requires a non-empty rpcUrl');
    this.rpcUrl = rpcUrl;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
  }

  /** One JSON-RPC round-trip. Throws on HTTP, transport, timeout, or RPC error. */
  private async call<T>(method: string, params: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Network failure or AbortSignal timeout — transient, never a finality signal.
      throw new Error(`Solana RPC ${method} request failed: ${(err as Error).message}`);
    }

    if (!res.ok) {
      throw new Error(`Solana RPC ${method} returned HTTP ${res.status}`);
    }

    let body: { result?: T; error?: { code?: number; message?: string } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new Error(`Solana RPC ${method} returned malformed JSON`);
    }

    if (body.error) {
      throw new Error(`Solana RPC ${method} error: ${body.error.message ?? 'unknown'}`);
    }
    if (body.result === undefined) {
      throw new Error(`Solana RPC ${method} returned no result`);
    }
    return body.result;
  }

  /**
   * `getSignatureStatuses([sig], { searchTransactionHistory: true })`.
   *
   * `searchTransactionHistory: true` is required: the status cache only holds
   * recent signatures, so a deposit polled minutes later would otherwise read as
   * "not found" even when finalized. Returns `null` when the signature is
   * genuinely unknown (→ caller treats as still-pending).
   */
  async getSignatureStatus(signature: string): Promise<SignatureStatus | null> {
    type RawStatus = {
      slot: number | null;
      confirmations: number | null;
      err: unknown | null;
      confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
    };
    const result = await this.call<{ value: Array<RawStatus | null> }>('getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: true },
    ]);

    const raw = result.value[0];
    if (!raw) return null;

    return {
      signature,
      confirmationStatus: raw.confirmationStatus ?? null,
      confirmations: raw.confirmations ?? null,
      slot: raw.slot ?? null,
      err: raw.err ?? null,
    };
  }

  /** `getTokenAccountBalance(ata, { commitment: 'finalized' })` — for reconciliation. */
  async getTokenAccountBalance(address: string): Promise<TokenAccountBalance> {
    type RawBalance = {
      amount: string;
      decimals: number;
      uiAmount: number | null;
      uiAmountString: string;
    };
    const result = await this.call<{ value: RawBalance }>('getTokenAccountBalance', [
      address,
      { commitment: 'finalized' },
    ]);
    const v = result.value;
    return {
      amount: v.amount,
      decimals: v.decimals,
      uiAmount: v.uiAmount ?? null,
      uiAmountString: v.uiAmountString,
    };
  }

  /** `getSignaturesForAddress(address, { limit, before, until })`. */
  async getSignaturesForAddress(
    address: string,
    options: SignaturesForAddressOptions = {},
  ): Promise<SignatureInfo[]> {
    const cfg: Record<string, unknown> = {};
    if (options.limit !== undefined) cfg['limit'] = options.limit;
    if (options.before !== undefined) cfg['before'] = options.before;
    if (options.until !== undefined) cfg['until'] = options.until;

    type RawSig = { signature: string; slot: number; blockTime: number | null };
    const result = await this.call<RawSig[]>('getSignaturesForAddress', [address, cfg]);
    return result.map((s) => ({
      signature: s.signature,
      slot: s.slot,
      blockTime: s.blockTime ?? null,
    }));
  }
}
