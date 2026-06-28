import { PageContainer } from '@/components/ui/page-container';
import { Skeleton } from '@/components/ui/skeleton';

const SECTIONS = ['account', 'wallet', 'balance'];

/** Dashboard loading skeleton. */
export default function Loading() {
  return (
    <PageContainer size="md">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--rx-space-3)',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--rx-color-border)',
          paddingBottom: '1rem',
        }}
      >
        <Skeleton width={160} height={28} />
        <Skeleton width={120} height={36} radius="var(--rx-radius-lg)" />
      </div>
      {SECTIONS.map((k) => (
        <section key={k} style={{ marginTop: 'var(--rx-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
          <Skeleton width={140} height={20} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="50%" height={14} />
        </section>
      ))}
    </PageContainer>
  );
}
