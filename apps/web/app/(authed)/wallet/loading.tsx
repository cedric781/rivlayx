import { PageContainer } from '@/components/ui/page-container';
import { Skeleton } from '@/components/ui/skeleton';

const ROWS = ['r1', 'r2', 'r3'];

/** Wallet loading skeleton — header, balance card, recent deposits. */
export default function Loading() {
  return (
    <PageContainer size="lg">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--rx-space-3)',
          flexWrap: 'wrap',
          marginBottom: '2rem',
        }}
      >
        <Skeleton width={120} height={28} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Skeleton width={96} height={36} radius="var(--rx-radius-md)" />
          <Skeleton width={130} height={36} radius="var(--rx-radius-md)" />
        </div>
      </div>

      {/* Balance card */}
      <Skeleton height={132} radius="var(--rx-radius-xl)" />

      <div style={{ marginTop: 'var(--rx-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-3)' }}>
        <Skeleton width={180} height={20} />
        {ROWS.map((k) => (
          <Skeleton key={k} height={40} radius="var(--rx-radius-md)" />
        ))}
      </div>
    </PageContainer>
  );
}
