import type { BetStatus } from '@rivlayx/db';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/** Lifecycle status → semantic badge tone. */
const TONE: Record<BetStatus, BadgeTone> = {
  DRAFT: 'neutral',
  OPEN: 'success',
  ACTIVE: 'info',
  AWAITING_RESULT: 'warning',
  DISPUTED: 'danger',
  RESOLVED: 'info',
  SETTLING: 'info',
  SETTLED: 'success',
  PAID: 'success',
  VOID: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

const LABELS: Partial<Record<BetStatus, string>> = {
  AWAITING_RESULT: 'Awaiting result',
};

/** Coloured lifecycle badge (bet card + detail page). */
export function StatusBadge({ status }: { status: BetStatus }) {
  return (
    <Badge tone={TONE[status] ?? 'neutral'} uppercase>
      {LABELS[status] ?? status}
    </Badge>
  );
}
