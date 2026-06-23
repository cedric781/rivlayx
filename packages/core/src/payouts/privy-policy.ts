import Decimal from 'decimal.js';

/**
 * Delegated-signing policy (Phase 2). Two layers protect every transfer:
 *   1. An on-wallet Privy policy (default-deny, applied at provisioning) — the
 *      authoritative guard enforced by Privy.
 *   2. This in-process `assertTransferAllowed` guard — defense-in-depth, run
 *      BEFORE the signer is ever called, so a disallowed transfer never reaches
 *      Privy. Same rules, two enforcement points.
 *
 * Allowed: an SPL **USDC** `transferChecked` from the user's own embedded wallet
 * to an allowlisted destination (escrow for stakes; validated external for
 * withdrawals), amount > 0 and ≤ cap. Everything else is denied.
 */
export interface PrivyTransferPolicy {
  /** The only SPL mint that may be transferred. */
  usdcMint: string;
  /** Allowlisted destination wallets (base58). e.g. `[escrowWallet]`. */
  allowedDestinations: readonly string[];
  /** Hard per-transfer cap (USDC decimal string). */
  maxAmountUsdc: string;
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
  if (!policy.allowedDestinations.includes(intent.toWallet)) {
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
        destinations: [...policy.allowedDestinations],
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
