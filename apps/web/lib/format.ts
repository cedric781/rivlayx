/**
 * Canonical money presentation helper for the consumer web app.
 *
 * Single source of truth for rendering USDC amounts: always exactly 2 decimals
 * with a trailing " USDC". Non-finite or otherwise invalid input renders
 * "0.00 USDC" rather than echoing the bad value.
 *
 * `lib/marketplace/format` and `components/wallet/format` re-export this so
 * existing import paths keep working. Presentation only — no money logic here.
 */
export function formatUsdc(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '0.00 USDC';
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDC`;
}
