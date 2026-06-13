import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { can } from '@rivlayx/auth';
import { bets, betParticipants, disputes, users } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForBetStatus, toneForDisputeStatus } from '@/components/status-badge';
import { ActionButton } from '@/components/action-button';

export const metadata = { title: 'Dispute — RivlayX Admin' };

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const { id } = await params;

  const db = getDb();
  const [row] = await db
    .select({
      dispute: disputes,
      bet: bets,
      opener: { id: users.id, email: users.email },
    })
    .from(disputes)
    .leftJoin(bets, eq(bets.id, disputes.betId))
    .leftJoin(users, eq(users.id, disputes.openerUserId))
    .where(eq(disputes.id, id))
    .limit(1);

  if (!row || !row.bet) {
    return (
      <AdminShell user={user} roles={roles}>
        <h1>Dispute not found</h1>
        <Link href="/disputes" style={{ color: '#5b8def' }}>
          ← Back to disputes
        </Link>
      </AdminShell>
    );
  }

  const participants = await db
    .select({ p: betParticipants, u: { id: users.id, email: users.email } })
    .from(betParticipants)
    .leftJoin(users, eq(users.id, betParticipants.userId))
    .where(eq(betParticipants.betId, row.bet.id));

  const canRule = can(roles, 'ruleDispute');

  return (
    <AdminShell user={user} roles={roles}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/disputes" style={{ color: '#5b8def', fontSize: 13 }}>
          ← Back to disputes
        </Link>
      </div>
      <h1 style={{ margin: 0 }}>Dispute</h1>
      <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <StatusBadge label={row.dispute.status} tone={toneForDisputeStatus(row.dispute.status)} />
        <span style={{ opacity: 0.6, fontSize: 13 }}>
          Opened {new Date(row.dispute.openedAt).toISOString()}
        </span>
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Linked bet</h2>
        <p>
          <Link href={`/bets/${row.bet.id}`} style={{ color: '#5b8def', fontFamily: 'monospace' }}>
            {row.bet.shortCode}
          </Link>{' '}
          <StatusBadge label={row.bet.status} tone={toneForBetStatus(row.bet.status)} />
        </p>
        <p>Title: {row.bet.title}</p>
        <p>Stake/side: {row.bet.stakePerSideUsdc} USDC</p>
        <p>
          Proposed winner: <code>{row.bet.proposedWinnerUserId ?? '—'}</code>
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Participants</h2>
        <ul>
          {participants.map((p) => (
            <li key={p.p.userId}>
              {p.p.role}: <code>{p.u?.email ?? p.p.userId}</code> · side <strong>{p.p.side}</strong>{' '}
              · stake {p.p.stakeLockedUsdc} USDC
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Opener</h2>
        <p>{row.opener?.email ?? row.dispute.openerUserId}</p>
        <p>
          Claimed winner: <code>{row.dispute.claimedWinnerUserId}</code>
        </p>
        <p>
          Deposit: <strong>{row.dispute.depositUsdc} USDC</strong>
        </p>
        <p style={{ whiteSpace: 'pre-wrap' }}>
          <strong>Reason:</strong>
          <br />
          {row.dispute.reason}
        </p>
      </section>

      {row.dispute.ruledAt && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: 18 }}>Ruling</h2>
          <p>
            Ruled at {new Date(row.dispute.ruledAt).toISOString()} by{' '}
            <code>{row.dispute.ruledByUserId}</code>
          </p>
          {row.dispute.rulingNotes && (
            <p style={{ whiteSpace: 'pre-wrap' }}>{row.dispute.rulingNotes}</p>
          )}
        </section>
      )}

      {row.dispute.status === 'open' && canRule && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: 18 }}>Actions (admin)</h2>
          <ActionButton
            endpoint={`/api/admin/disputes/${row.dispute.id}/rule`}
            label="Uphold dispute"
            body={{ ruling: 'uphold' }}
            confirmMessage="Uphold this dispute? Claimed winner becomes resolved winner; opener gets deposit back."
          />
          <ActionButton
            endpoint={`/api/admin/disputes/${row.dispute.id}/rule`}
            label="Reject dispute"
            tone="danger"
            body={{ ruling: 'reject' }}
            confirmMessage="Reject this dispute? Proposed result stands; opener forfeits the deposit."
          />
        </section>
      )}

      {!canRule && row.dispute.status === 'open' && (
        <p style={{ marginTop: '2rem', opacity: 0.6, fontSize: 13 }}>
          You have read-only access. Ruling requires admin privileges.
        </p>
      )}
    </AdminShell>
  );
}
