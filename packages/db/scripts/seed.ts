import { config as loadDotenv } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@rivlayx/shared/password';
import { createDb, userRoles, users, wallets } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '..', '..', '..', '.env') });

const url = process.env['DATABASE_URL'];
const bootstrapEmail = process.env['BOOTSTRAP_ADMIN_EMAIL'];
const bootstrapPassword = process.env['BOOTSTRAP_ADMIN_PASSWORD'];

if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!bootstrapEmail) {
  console.error('BOOTSTRAP_ADMIN_EMAIL is required to seed the initial super_admin');
  process.exit(1);
}
// First-factor admin login requires a real password; refuse to seed an admin
// that could never sign in (fail-closed — no email-only access).
if (!bootstrapPassword) {
  console.error('BOOTSTRAP_ADMIN_PASSWORD is required to seed the initial super_admin');
  process.exit(1);
}

const handle = createDb(url, { max: 1 });

try {
  const existing = await handle.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, bootstrapEmail))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Bootstrap user already exists: ${bootstrapEmail}`);
    process.exit(0);
  }

  const privyId = `mock_${createHash('sha256').update(bootstrapEmail).digest('hex').slice(0, 16)}`;
  const walletAddress = `Mock${createHash('sha256').update(bootstrapEmail).digest('hex').slice(0, 40)}`;

  await handle.db.transaction(async (tx) => {
    const userId = randomUUID();
    await tx.insert(users).values({
      id: userId,
      privyId,
      email: bootstrapEmail,
      username: 'admin',
      displayName: 'Bootstrap Super Admin',
      status: 'active',
      passwordHash: hashPassword(bootstrapPassword),
      mfaRequired: true,
    });
    await tx.insert(wallets).values({
      userId,
      chain: 'solana',
      address: walletAddress,
      source: 'mock_dev',
      isPrimary: true,
    });
    await tx.insert(userRoles).values([
      { userId, role: 'user' },
      { userId, role: 'super_admin' },
    ]);
    console.log(`Seeded super_admin: ${bootstrapEmail} (id=${userId})`);
  });
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
