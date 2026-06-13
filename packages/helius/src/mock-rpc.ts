import type {
  IHeliusRpc,
  SignatureInfo,
  SignatureStatus,
  SignaturesForAddressOptions,
  TokenAccountBalance,
} from './rpc-interface';

/**
 * In-memory RPC mock for tests. Set programmable responses via the `setX`
 * methods; calls return the configured state. Default behaviour is "empty":
 * unknown signature → null, unknown balance → zero, unknown address → [].
 */
export class MockHeliusRpc implements IHeliusRpc {
  private statuses = new Map<string, SignatureStatus>();
  private balances = new Map<string, TokenAccountBalance>();
  private signatures = new Map<string, SignatureInfo[]>();

  setSignatureStatus(signature: string, status: SignatureStatus): void {
    this.statuses.set(signature, status);
  }

  setTokenAccountBalance(address: string, balance: TokenAccountBalance): void {
    this.balances.set(address, balance);
  }

  setSignaturesForAddress(address: string, sigs: SignatureInfo[]): void {
    this.signatures.set(address, sigs);
  }

  clearAll(): void {
    this.statuses.clear();
    this.balances.clear();
    this.signatures.clear();
  }

  getSignatureStatus(signature: string): Promise<SignatureStatus | null> {
    return Promise.resolve(this.statuses.get(signature) ?? null);
  }

  getTokenAccountBalance(address: string): Promise<TokenAccountBalance> {
    return Promise.resolve(
      this.balances.get(address) ?? {
        amount: '0',
        decimals: 6,
        uiAmount: 0,
        uiAmountString: '0',
      },
    );
  }

  getSignaturesForAddress(
    address: string,
    options?: SignaturesForAddressOptions,
  ): Promise<SignatureInfo[]> {
    const all = this.signatures.get(address) ?? [];
    let result = [...all];
    if (options?.before) {
      const idx = result.findIndex((s) => s.signature === options.before);
      if (idx >= 0) result = result.slice(idx + 1);
    }
    if (options?.until) {
      const idx = result.findIndex((s) => s.signature === options.until);
      if (idx >= 0) result = result.slice(0, idx);
    }
    if (options?.limit !== undefined) result = result.slice(0, options.limit);
    return Promise.resolve(result);
  }
}
