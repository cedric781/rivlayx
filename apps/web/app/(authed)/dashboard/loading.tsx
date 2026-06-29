import { PageContainer } from '@/components/ui/page-container';
import { Skeleton } from '@/components/ui/skeleton';

const STATS = ['s1', 's2', 's3', 's4'];
const ROWS = ['r1', 'r2', 'r3'];

/** Dashboard loading skeleton — mirrors the redesigned layout to avoid shift. */
export default function Loading() {
  return (
    <PageContainer size="lg">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 'var(--rx-space-4)',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--rx-color-border)',
          paddingBottom: 'var(--rx-space-5)',
        }}
      >
        <Skeleton width={220} height={32} />
        <Skeleton width={130} height={38} radius="var(--rx-radius-lg)" />
      </div>

      {/* Balance hero + quick actions */}
      <div
        style={{
          marginTop: 'var(--rx-space-6)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--rx-space-4)',
        }}
      >
        <Skeleton height={148} radius="var(--rx-radius-xl)" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--rx-space-3)' }}>
          {STATS.map((k) => (
            <Skeleton key={k} height={68} radius="var(--rx-radius-lg)" />
          ))}
        </div>
      </div>

      {/* At a glance */}
      <div style={{ marginTop: 'var(--rx-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-3)' }}>
        <Skeleton width={120} height={22} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--rx-space-3)' }}>
          {STATS.map((k) => (
            <Skeleton key={k} height={84} radius="var(--rx-radius-xl)" />
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div style={{ marginTop: 'var(--rx-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
        <Skeleton width={160} height={22} />
        {ROWS.map((k) => (
          <Skeleton key={k} height={56} radius="var(--rx-radius-lg)" />
        ))}
      </div>
    </PageContainer>
  );
}
