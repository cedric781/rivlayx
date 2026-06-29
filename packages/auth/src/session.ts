import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { sessions, type NewSession, type Session, type SessionApp } from '@rivlayx/db';

/**
 * Loose Drizzle handle accepting both the production postgres-js driver and
 * the pglite test driver. Identical motivation as `LedgerDb` in `@rivlayx/core`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuthDb = any;

export interface SessionLimits {
  idleMs: number;
  maxMs: number;
}

const HOUR = 3_600_000;
const MIN = 60_000;

export function defaultLimits(app: SessionApp): SessionLimits {
  // User: idle 30min, hard cap 12h. Admin: idle 30min, hard cap 8h.
  return app === 'user'
    ? { idleMs: 30 * MIN, maxMs: 12 * HOUR }
    : { idleMs: 30 * MIN, maxMs: 8 * HOUR };
}

export function generateSessionId(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(
  db: AuthDb,
  input: {
    userId: string;
    app: SessionApp;
    ip?: string | null;
    userAgent?: string | null;
    limits?: SessionLimits;
  },
): Promise<Session> {
  const id = generateSessionId();
  const limits = input.limits ?? defaultLimits(input.app);
  const expiresAt = new Date(Date.now() + limits.maxMs);
  const row: NewSession = {
    id,
    userId: input.userId,
    app: input.app,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    expiresAt,
  };
  const [inserted] = await db.insert(sessions).values(row).returning();
  if (!inserted) throw new Error('Failed to create session');
  return inserted;
}

export async function loadActiveSession(db: AuthDb, id: string): Promise<Session | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function touchSession(db: AuthDb, id: string): Promise<void> {
  await db.update(sessions).set({ lastActivityAt: new Date() }).where(eq(sessions.id, id));
}

export async function revokeSession(db: AuthDb, id: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
}

export async function markMfaVerified(db: AuthDb, id: string): Promise<void> {
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, id));
}

export function isIdleExpired(session: Session, limits: SessionLimits): boolean {
  return session.lastActivityAt.getTime() + limits.idleMs <= Date.now();
}

/**
 * C5 — MFA freshness. A session's MFA is "fresh" only when it was verified
 * within `maxAgeMs`. Money approvals require fresh MFA, so a one-time
 * verification cannot stay valid for the whole session lifetime.
 */
export function isMfaFresh(session: Session, maxAgeMs: number, now: Date = new Date()): boolean {
  if (!session.mfaVerifiedAt) return false;
  return session.mfaVerifiedAt.getTime() + maxAgeMs > now.getTime();
}
