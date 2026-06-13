/** Presentation helpers for the marketplace UI. Pure + framework-agnostic. */

export function formatUsdc(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return `${amount} USDC`;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

export function humanizeCategory(category: string): string {
  if (category === 'open_objective') return 'Open Objective';
  if (category === 'mma') return 'MMA';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

const RESOLVE_LABELS: Record<string, string> = {
  auto: 'Auto',
  evidence: 'Evidence',
  arbiter: 'Arbiter',
};
export function humanizeResolveType(resolveType: string): string {
  return RESOLVE_LABELS[resolveType] ?? resolveType;
}

export function formatDateTime(value: Date | string | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact "in 3d" / "in 5h" / "soon" countdown relative to now. */
export function formatExpiry(value: Date | string | null, now: Date = new Date()): string {
  if (!value) return 'No deadline';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}
