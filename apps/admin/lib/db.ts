import { createDb, type DbHandle } from '@rivlayx/db';
import { getEnv } from './env';

const globalAny = globalThis as unknown as { __rivlayx_admin_db?: DbHandle };

export function getDb() {
  globalAny.__rivlayx_admin_db ??= createDb(getEnv().DATABASE_URL);
  return globalAny.__rivlayx_admin_db.db;
}
