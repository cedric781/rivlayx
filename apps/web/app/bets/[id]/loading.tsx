import { PageContainer } from '@/components/ui/page-container';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const bar = { background: 'var(--rx-color-paper-border-muted)' } as const;
const CARDS = ['meta', 'rules', 'participants'];

/** Bet-detail loading skeleton — mirrors the stacked detail cards. */
export default function Loading() {
  return (
    <PageContainer size="md">
      <Skeleton width={140} height={14} />
      <div style={{ height: 'var(--rx-space-4)' }} />
      <Skeleton width="70%" height={28} />
      <div style={{ height: 'var(--rx-space-5)' }} />
      {CARDS.map((k) => (
        <Card key={k} style={{ marginBottom: 'var(--rx-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-3)' }}>
          <Skeleton width="40%" height={16} style={bar} />
          <Skeleton width="90%" height={14} style={bar} />
          <Skeleton width="75%" height={14} style={bar} />
        </Card>
      ))}
    </PageContainer>
  );
}
