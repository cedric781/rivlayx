import { PageContainer } from '@/components/ui/page-container';
import { Skeleton } from '@/components/ui/skeleton';

const STATS = ['s1', 's2', 's3', 's4'];
const ITEMS = ['i1', 'i2', 'i3'];

/** Profile loading skeleton — shared by `/profile` and `/profile/[username]`. */
export default function Loading() {
  return (
    <PageContainer size="lg">
      <header style={{ marginBottom: 'var(--rx-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
        <Skeleton width={220} height={28} />
        <Skeleton width={160} height={14} />
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--rx-space-3)',
          marginBottom: 'var(--rx-space-6)',
        }}
      >
        {STATS.map((k) => (
          <Skeleton key={k} height={72} radius="var(--rx-radius-xl)" />
        ))}
      </div>

      <Skeleton width={140} height={20} />
      <div style={{ marginTop: 'var(--rx-space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
        {ITEMS.map((k) => (
          <Skeleton key={k} height={64} radius="var(--rx-radius-lg)" />
        ))}
      </div>
    </PageContainer>
  );
}
