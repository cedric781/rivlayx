import { PageContainer } from '@/components/ui/page-container';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const bar = { background: 'var(--rx-color-paper-border-muted)' } as const;
const KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Marketplace loading skeleton — mirrors the bet-card grid to avoid layout shift. */
export default function Loading() {
  return (
    <PageContainer size="xl">
      <Skeleton width={180} height={28} />
      <div style={{ height: 'var(--rx-space-5)' }} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '1rem',
        }}
      >
        {KEYS.map((k) => (
          <Card key={k} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-3)' }}>
            <Skeleton width={90} height={18} style={bar} />
            <Skeleton width="80%" height={18} style={bar} />
            <Skeleton width="55%" height={14} style={bar} />
            <div
              style={{
                display: 'flex',
                gap: 'var(--rx-space-4)',
                borderTop: '1px solid var(--rx-color-paper-border-muted)',
                paddingTop: 'var(--rx-space-3)',
              }}
            >
              <Skeleton width={72} height={30} style={bar} />
              <Skeleton width={72} height={30} style={bar} />
            </div>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
