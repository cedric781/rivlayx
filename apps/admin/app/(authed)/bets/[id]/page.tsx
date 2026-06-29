import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { can } from '@rivlayx/auth';
import { formatUsdc } from '@rivlayx/shared';
import {
  betAuditLog,
  betEvents,
  betEvidence,
  betParticipants,
  betRules,
  bets,
  disputes,
  users,
  type BetStatus,
} from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForBetStatus, toneForDisputeStatus } from '@/components/status-badge';
import { ActionButton } from '@/components/action-button';

export const metadata = { title: 'Bet — RivlayX Admin' };

const VOIDABLE: BetStatus[] = ['OPEN', 'ACTIVE', 'AWAITING_RESULT', 'DISPUTED'];
/** States where an admin can still rule a winner (before any result is proposed). */
const RESOLVABLE: BetStatus[] = ['ACTIVE', 'AWAITING_RESULT'];

export default async function BetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const { id } = await params;

  const db = getDb();
  const [bet] = await db.select().from(bets).where(eq(bets.id, id)).limit(1);
  if (!bet) {
    return (
      <AdminShell user={user} roles={roles}>
        <h1>Bet not found</h1>
        <Link href="/bets" style={{ color: '#5b8def' }}>
          ← Back
        </Link>
      </AdminShell>
    );
  }

  const participants = await db
    .select({ p: betParticipants, u: { id: users.id, email: users.email } })
    .from(betParticipants)
    .leftJoin(users, eq(users.id, betParticipants.userId))
    .where(eq(betParticipants.betId, bet.id));
  const rules = await db.select().from(betRules).where(eq(betRules.betId, bet.id));
  const events = await db
    .select()
    .from(betEvents)
    .where(eq(betEvents.betId, bet.id))
    .orderBy(desc(betEvents.createdAt))
    .limit(50);
  const audit = await db
    .select()
    .from(betAuditLog)
    .where(eq(betAuditLog.betId, bet.id))
    .orderBy(desc(betAuditLog.at))
    .limit(50);
  const disputeRows = await db.select().from(disputes).where(eq(disputes.betId, bet.id));
  const evidence = await db
    .select()
    .from(betEvidence)
    .where(eq(betEvidence.betId, bet.id))
    .orderBy(desc(betEvidence.uploadedAt));

  const canVoid = can(roles, 'voidBet') && VOIDABLE.includes(bet.status);
  const canResolve =
    can(roles, 'ruleDispute') &&
    RESOLVABLE.includes(bet.status) &&
    !bet.resolvedWinnerUserId &&
    !bet.proposedWinnerUserId;
  const creatorRow = participants.find((row) => row.p.role === 'creator');
  const acceptorRow = participants.find((row) => row.p.role === 'acceptor');

  return (
    <AdminShell user={user} roles={roles}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/bets" style={{ color: '#5b8def', fontSize: 13 }}>
          ← Back
        </Link>
      </div>
      <h1 style={{ margin: 0 }}>{bet.title}</h1>
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: 12, alignItems: 'center' }}>
        <StatusBadge label={bet.status} tone={toneForBetStatus(bet.status)} />
        <code style={{ fontSize: 13, opacity: 0.7 }}>{bet.shortCode}</code>
        <span style={{ opacity: 0.5, fontSize: 12 }}>
          {bet.betType} · {bet.resolveType}-resolve · arbiter={bet.arbiterType}
        </span>
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Participants &amp; escrow</h2>
        <p>
          Stake per side: {formatUsdc(bet.stakePerSideUsdc)} · settlement fee {bet.settlementFeeBps} bps
        </p>
        <ul>
          {participants.map((row) => (
            <li key={row.p.userId}>
              {row.p.role}: <code>{row.u?.email ?? row.p.userId}</code> · side {row.p.side} · locked{' '}
              {formatUsdc(row.p.stakeLockedUsdc)}
            </li>
          ))}
        </ul>
        {bet.proposedWinnerUserId && (
          <p>
            Proposed winner: <code>{bet.proposedWinnerUserId}</code>
            {bet.disputeWindowEndsAt && (
              <> · window ends {new Date(bet.disputeWindowEndsAt).toISOString()}</>
            )}
          </p>
        )}
        {bet.resolvedWinnerUserId && (
          <p>
            Resolved winner: <code>{bet.resolvedWinnerUserId}</code>
          </p>
        )}
      </section>

      {canResolve && (
        <section
          style={{
            marginTop: '2rem',
            border: '1px solid #2c3036',
            borderRadius: 6,
            padding: '1rem 1.25rem',
            background: '#13161a',
          }}
        >
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Resolve (admin)</h2>
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
            Rule which side won. This proposes the winner via the resolve engine and opens the
            standard dispute window — the existing settlement flow pays out the winner after the
            window closes. No money moves here.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ActionButton
              endpoint={`/api/admin/bets/${bet.id}/resolve`}
              label={`Creator wins${creatorRow?.u?.email ? ` — ${creatorRow.u.email}` : ''}`}
              body={{ winner: 'creator' }}
              requireReason
              confirmMessage="Rule the CREATOR as winner? Opens the dispute window, then settles to the creator."
            />
            <ActionButton
              endpoint={`/api/admin/bets/${bet.id}/resolve`}
              label={`Acceptor wins${acceptorRow?.u?.email ? ` — ${acceptorRow.u.email}` : ''}`}
              body={{ winner: 'acceptor' }}
              requireReason
              confirmMessage="Rule the ACCEPTOR as winner? Opens the dispute window, then settles to the acceptor."
            />
          </div>
        </section>
      )}

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Rules</h2>
        <ul>
          {rules.map((r) => (
            <li key={`${r.betId}:${r.ruleIndex}`}>
              <strong>{r.display}</strong>
              <pre
                style={{
                  background: '#13161a',
                  padding: '0.5rem',
                  borderRadius: 4,
                  fontSize: 12,
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(r.predicate, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Evidence</h2>
        {evidence.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 13 }}>No evidence submitted for this bet.</p>
        ) : (
          <ul style={{ fontSize: 13 }}>
            {evidence.map((e) => (
              <li key={e.id} style={{ marginBottom: 4 }}>
                <code>{e.storageKey}</code> · {e.contentType ?? 'unknown type'} · sha256{' '}
                <code>{e.sha256.slice(0, 12)}…</code> · {e.uploadedAt.toISOString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      {disputeRows.length > 0 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: 18 }}>Disputes</h2>
          <ul>
            {disputeRows.map((d) => (
              <li key={d.id}>
                <Link href={`/disputes/${d.id}`} style={{ color: '#5b8def' }}>
                  {d.id.slice(0, 8)}
                </Link>{' '}
                <StatusBadge label={d.status} tone={toneForDisputeStatus(d.status)} /> · deposit{' '}
                {formatUsdc(d.depositUsdc)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Audit trail</h2>
        <ul style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {audit.map((a) => (
            <li key={String(a.id)}>
              {a.at.toISOString()} · {a.fromStatus ?? 'NULL'} → {a.toStatus} · {a.actorType}{' '}
              {a.actorUserId ?? 'system'} · {a.reason ?? ''}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Events</h2>
        <ul style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {events.map((e) => (
            <li key={String(e.id)}>
              {e.createdAt.toISOString()} · {e.eventType} · {e.actorUserId ?? 'system'}
            </li>
          ))}
        </ul>
      </section>

      {canVoid && (
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ fontSize: 18 }}>Actions (admin)</h2>
          <ActionButton
            endpoint={`/api/admin/bets/${bet.id}/void`}
            label="Void bet"
            tone="danger"
            requireReason
            confirmMessage="Void this bet? Stakes refund to participants; open disputes are refunded."
          />
        </section>
      )}
    </AdminShell>
  );
}
