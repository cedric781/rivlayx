import { createDb, type DbHandle } from '@rivlayx/db';
import { getEnv } from './env';

// Cache on globalThis to survive Next.js HMR in dev (avoids leaking pools).
const globalAny = globalThis as unknown as { __rivlayx_db?: DbHandle };

export function getDb() {
  globalAny.__rivlayx_db ??= createDb(getEnv().DATABASE_URL);
  return globalAny.__rivlayx_db.db;
}
