/** Re-exported from the canonical money helper; see `@/lib/format`. */
export { formatUsdc } from '@/lib/format';

/** Truncate a Solana-ish address for compact display: `Abc1...zXyz` */
export function truncateAddress(address: string, prefix = 4, suffix = 4): string {
  if (address.length <= prefix + suffix + 1) return address;
  return `${address.slice(0, prefix)}…${address.slice(-suffix)}`;
}
