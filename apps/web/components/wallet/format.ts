/**
 * Format a USDC amount string for display. Always renders at least 2 decimals
 * and up to 6 (USDC's native precision).
 */
export function formatUsdc(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/** Truncate a Solana-ish address for compact display: `Abc1...zXyz` */
export function truncateAddress(address: string, prefix = 4, suffix = 4): string {
  if (address.length <= prefix + suffix + 1) return address;
  return `${address.slice(0, prefix)}…${address.slice(-suffix)}`;
}
