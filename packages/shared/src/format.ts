/**
 * Canonical USDC presentation helper, shared across apps.
 *
 * Always renders exactly 2 decimals with a trailing " USDC". Non-finite or
 * otherwise invalid input renders "0.00 USDC" rather than echoing the bad
 * value. Presentation only — money math lives in `usdc.ts`; do not use this
 * for ledger arithmetic.
 */
export function formatUsdc(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '0.00 USDC';
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}
