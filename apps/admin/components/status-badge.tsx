const TONES: Record<string, { bg: string; fg: string }> = {
  green: { bg: 'var(--rx-color-success-surface)', fg: 'var(--rx-color-success-fg)' },
  red: { bg: 'var(--rx-color-danger-surface)', fg: 'var(--rx-color-danger-fg)' },
  yellow: { bg: 'var(--rx-color-warning-surface)', fg: 'var(--rx-color-warning-fg)' },
  blue: { bg: 'var(--rx-color-info-surface)', fg: 'var(--rx-color-info-fg)' },
  gray: { bg: 'var(--rx-color-muted-surface)', fg: 'var(--rx-color-text-muted)' },
};

export function StatusBadge({
  label,
  tone = 'gray',
}: {
  label: string;
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone] ?? TONES['gray']!;
  return (
    <span
      style={{
        display: 'inline-block',
        background: t.bg,
        color: t.fg,
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {label}
    </span>
  );
}

export function toneForDisputeStatus(status: string): keyof typeof TONES {
  switch (status) {
    case 'open':
      return 'yellow';
    case 'upheld':
      return 'green';
    case 'rejected':
      return 'red';
    case 'withdrawn':
      return 'gray';
    default:
      return 'gray';
  }
}

export function toneForBetStatus(status: string): keyof typeof TONES {
  switch (status) {
    case 'OPEN':
      return 'yellow';
    case 'ACTIVE':
      return 'blue';
    case 'AWAITING_RESULT':
      return 'yellow';
    case 'DISPUTED':
      return 'red';
    case 'RESOLVED':
    case 'PAID':
      return 'green';
    case 'VOID':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'gray';
    default:
      return 'gray';
  }
}

export function toneForUserStatus(status: string): keyof typeof TONES {
  switch (status) {
    case 'active':
      return 'green';
    case 'suspended':
      return 'yellow';
    case 'banned':
      return 'red';
    case 'deleted':
      return 'gray';
    default:
      return 'gray';
  }
}
