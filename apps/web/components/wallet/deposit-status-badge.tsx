import type { DepositStatus } from '@rivlayx/db';

const STYLES: Record<DepositStatus, { bg: string; fg: string; label: string }> = {
  pending: { bg: '#3a2c0a', fg: '#f0c674', label: 'Pending' },
  confirmed: { bg: '#0d2a3f', fg: '#5b8def', label: 'Confirmed' },
  credited: { bg: '#103a1f', fg: '#5fd47a', label: 'Credited' },
  rejected: { bg: '#3a0d0d', fg: '#ff6b6b', label: 'Rejected' },
};

export function DepositStatusBadge({ status }: { status: DepositStatus }) {
  const style = STYLES[status];
  return (
    <span
      title={`Deposit status: ${style.label}`}
      style={{
        display: 'inline-block',
        background: style.bg,
        color: style.fg,
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {style.label}
    </span>
  );
}
