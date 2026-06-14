import type { BetStatus } from '@rivlayx/db';

/** Background / text colour pair per lifecycle status. */
const STYLES: Record<BetStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: '#f1f5f9', fg: '#64748b' },
  OPEN: { bg: '#dcfce7', fg: '#15803d' },
  ACTIVE: { bg: '#dbeafe', fg: '#1d4ed8' },
  AWAITING_RESULT: { bg: '#fef9c3', fg: '#a16207' },
  DISPUTED: { bg: '#fee2e2', fg: '#b91c1c' },
  RESOLVED: { bg: '#e0e7ff', fg: '#4338ca' },
  SETTLING: { bg: '#ede9fe', fg: '#6d28d9' },
  SETTLED: { bg: '#d1fae5', fg: '#047857' },
  PAID: { bg: '#cffafe', fg: '#0e7490' },
  VOID: { bg: '#f1f5f9', fg: '#64748b' },
  EXPIRED: { bg: '#f1f5f9', fg: '#64748b' },
  CANCELLED: { bg: '#f1f5f9', fg: '#64748b' },
};

const LABELS: Partial<Record<BetStatus, string>> = {
  AWAITING_RESULT: 'Awaiting result',
};

/** Coloured lifecycle badge used on the bet detail page. */
export function StatusBadge({ status }: { status: BetStatus }) {
  const style = STYLES[status] ?? { bg: '#f1f5f9', fg: '#64748b' };
  const label = LABELS[status] ?? status;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 999,
        background: style.bg,
        color: style.fg,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {label}
    </span>
  );
}
