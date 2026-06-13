const TONES: Record<string, { bg: string; fg: string }> = {
  green: { bg: '#103a1f', fg: '#5fd47a' },
  red: { bg: '#3a0d0d', fg: '#ff6b6b' },
  yellow: { bg: '#3a2c0a', fg: '#f0c674' },
  blue: { bg: '#0d2a3f', fg: '#5b8def' },
  gray: { bg: '#1a1d21', fg: '#9fa6ad' },
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
