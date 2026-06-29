import Decimal from 'decimal.js';
import { PublicKey } from '@solana/web3.js';

/**
 * Delegated-signing policy (Phase 2; Phase 6 adds dynamic destinations). Two
 * layers protect every transfer:
 *   1. An on-wallet Privy policy (default-deny, applied at provisioning) — the
 *      authoritative guard enforced by Privy.
 *   2. This in-process `assertTransferAllowed` guard — defense-in-depth, run
 *      BEFORE the signer is ever called, so a disallowed transfer never reaches
 *      Privy. Same rules, two enforcement points.
 *
 * Two destination modes:
 *   - **allowlist** (stakes → escrow): `allowedDestinations` is an exact set.
 *   - **dynamic** (withdrawals → arbitrary external): `allowDynamicDestinations`
 *     permits any VALID base58 wallet EXCEPT those in `deniedDestinations`
 *     (e.g. the escrow wallet) and except a self-transfer. The withdrawal amount
 *     cap and the USDC-mint restriction still apply in both modes.
 */
export interface PrivyTransferPolicy {
  /** The only SPL mint that may be transferred. */
  usdcMint: string;
  /**
   * Allowlisted destination wallets (base58) — allowlist mode, e.g. `[escrowWallet]`.
   * Consulted only when `allowDynamicDestinations` is falsy.
   */
  allowedDestinations?: readonly string[];
  /**
   * Dynamic mode: allow any valid external destination. Used for withdrawals,
   * whose destination is a per-request arbitrary wallet that cannot sit in a
   * static allowlist. Still bounded by `deniedDestinations`, the self-transfer
   * guard, the mint restriction and the amount cap.
   */
  allowDynamicDestinations?: boolean;
  /** Never-allowed destinations, even in dynamic mode (e.g. `[escrowWallet]`). */
  deniedDestinations?: readonly string[];
  /** Hard per-transfer cap (USDC decimal string). */
  maxAmountUsdc: string;
}

/** True when `address` is a valid 32-byte base58 Solana public key. */
function isValidWalletAddress(address: string): boolean {
  if (!address) return false;
  try {
    return new PublicKey(address).toBase58().length > 0;
  } catch {
    return false;
  }
}

export interface TransferIntent {
  fromWallet: string;
  toWallet: string;
  amountUsdc: string;
  mint: string;
}

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

export class PolicyViolationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PolicyViolationError';
  }
}

/** Pure policy evaluation. Returns the decision (with a reason on denial). */
export function checkTransferAllowed(
  intent: TransferIntent,
  policy: PrivyTransferPolicy,
): PolicyDecision {
  if (intent.mint !== policy.usdcMint) {
    return { allowed: false, reason: `mint ${intent.mint} is not the allowed USDC mint` };
  }
  if (intent.fromWallet === intent.toWallet) {
    return { allowed: false, reason: 'source and destination wallet are identical' };
  }
  // ── Destination: dynamic (withdrawals) or static allowlist (stakes) ──
  if (policy.allowDynamicDestinations) {
    if (!isValidWalletAddress(intent.toWallet)) {
      return { allowed: false, reason: `destination ${intent.toWallet} is not a valid wallet address` };
    }
    if (policy.deniedDestinations?.includes(intent.toWallet)) {
      return { allowed: false, reason: `destination ${intent.toWallet} is denied` };
    }
  } else if (!policy.allowedDestinations?.includes(intent.toWallet)) {
    return { allowed: false, reason: `destination ${intent.toWallet} is not allowlisted` };
  }
  const amt = new Decimal(intent.amountUsdc);
  if (!amt.isFinite() || amt.lte(0)) {
    return { allowed: false, reason: `amount ${intent.amountUsdc} must be > 0` };
  }
  if (amt.gt(new Decimal(policy.maxAmountUsdc))) {
    return { allowed: false, reason: `amount ${intent.amountUsdc} exceeds cap ${policy.maxAmountUsdc}` };
  }
  return { allowed: true };
}

/** Throwing variant — use as the pre-sign guard. */
export function assertTransferAllowed(intent: TransferIntent, policy: PrivyTransferPolicy): void {
  const decision = checkTransferAllowed(intent, policy);
  if (!decision.allowed) throw new PolicyViolationError(decision.reason);
}

/**
 * Structured description of the on-wallet Privy policy to apply at provisioning
 * (default-deny + one allow rule). Provider-neutral: the provisioning step maps
 * this to Privy's `WalletApiPolicy*` schema. Documented here so the allow/deny
 * surface lives in one place alongside the in-process guard.
 */
export function describeWalletPolicy(policy: PrivyTransferPolicy) {
  return {
    defaultDeny: true,
    allow: [
      {
        program: 'spl-token',
        instruction: 'transferChecked',
        mint: policy.usdcMint,
        destinations: policy.allowDynamicDestinations
          ? ('any' as const)
          : [...(policy.allowedDestinations ?? [])],
        deniedDestinations: [...(policy.deniedDestinations ?? [])],
        maxAmountUsdc: policy.maxAmountUsdc,
      },
    ],
    deny: [
      'spl-token:setAuthority',
      'spl-token:closeAccount',
      'spl-token:approve',
      'system:transfer', // no SOL drain from the user wallet
    ],
  } as const;
}
