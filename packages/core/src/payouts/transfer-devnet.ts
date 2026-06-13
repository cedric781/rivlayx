import { TransferPermanentError } from './errors';
import type { SolanaTransferProvider, TransferInput, TransferResult } from './types';

export interface DevnetConfig {
  /** Solana devnet RPC URL. */
  rpcUrl: string;
  /** Base58-encoded vault keypair private key. Devnet only. */
  vaultPrivateKeyBase58?: string;
  /** USDC mint address on devnet (different from mainnet). */
  usdcMint: string;
}

/**
 * Devnet placeholder. Sprint 11 ships the interface + mock; the actual
 * @solana/web3.js wire-up is a follow-up sprint. This class is included so
 * env wiring + admin UX have a real target to bind to, but every call throws
 * a permanent error until the vault key is configured AND the implementation
 * lands.
 */
export class DevnetSolanaTransferProvider implements SolanaTransferProvider {
  readonly name = 'devnet_solana';

  constructor(private readonly config: DevnetConfig) {}

  async buildAndSubmitTransfer(_input: TransferInput): Promise<TransferResult> {
    if (!this.config.vaultPrivateKeyBase58) {
      throw new TransferPermanentError(
        'devnet transfer provider not configured (vault key missing)',
      );
    }
    throw new TransferPermanentError(
      'devnet transfer execution not yet implemented (Sprint 11 ships mock + interface only)',
    );
  }
}
