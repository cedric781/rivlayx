import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * `auth` schema owns identity: users, wallets, role grants, sessions.
 * Tables added in Sprint 1.
 */
export const authSchema = pgSchema('auth');

// ───────────── value sets (type-only narrowing; runtime checks in Zod) ─────────────

export const userStatusValues = ['active', 'suspended', 'banned', 'deleted'] as const;
export type UserStatus = (typeof userStatusValues)[number];

export const walletSourceValues = ['mock_dev', 'privy_embedded', 'external_linked'] as const;
export type WalletSource = (typeof walletSourceValues)[number];

export const roleNameValues = ['user', 'moderator', 'admin', 'super_admin'] as const;
export type RoleName = (typeof roleNameValues)[number];

export const sessionAppValues = ['user', 'admin'] as const;
export type SessionApp = (typeof sessionAppValues)[number];

// ───────────── tables ─────────────

export const users = authSchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    privyId: varchar('privy_id', { length: 128 }).notNull().unique(),
    email: varchar('email', { length: 320 }).notNull().unique(),
    /** Public handle: lowercase, 3–20 chars, [a-z0-9_]. Unique. */
    username: varchar('username', { length: 20 }).notNull().unique(),
    displayName: varchar('display_name', { length: 80 }),
    status: varchar('status', { length: 16, enum: userStatusValues }).notNull().default('active'),
    mfaRequired: boolean('mfa_required').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
    statusIdx: index('users_status_idx').on(t.status),
    usernameFormat: check('users_username_format', sql`${t.username} ~ '^[a-z0-9_]{3,20}$'`),
  }),
);

export const wallets = authSchema.table(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chain: varchar('chain', { length: 16 }).notNull().default('solana'),
    address: varchar('address', { length: 64 }).notNull(),
    source: varchar('source', { length: 24, enum: walletSourceValues }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainAddressUnique: unique('wallets_chain_address_unique').on(t.chain, t.address),
    userIdx: index('wallets_user_idx').on(t.userId),
  }),
);

export const userRoles = authSchema.table(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16, enum: roleNameValues }).notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  }),
);

export const sessions = authSchema.table(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    app: varchar('app', { length: 8, enum: sessionAppValues }).notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    mfaVerifiedAt: timestamp('mfa_verified_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

// ───────────── admin audit log (Sprint 8) ─────────────
// Immutable record of every privileged admin action. Append-only at the
// application layer; DB column REVOKE UPDATE/DELETE is recommended in prod.

export const adminAuditLog = authSchema.table(
  'admin_audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Effective role at the time of action — captured for audit clarity. */
    actorRole: varchar('actor_role', { length: 32 }),
    /** Dot-namespaced action label, e.g. `user.suspend`, `freeze.set`. */
    action: varchar('action', { length: 64 }).notNull(),
    /** `user` | `bet` | `dispute` | `freeze` | `system`, etc. */
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 128 }),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('admin_audit_log_actor_idx').on(t.actorUserId, t.at),
    targetIdx: index('admin_audit_log_target_idx').on(t.targetType, t.targetId),
    actionIdx: index('admin_audit_log_action_idx').on(t.action, t.at),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
