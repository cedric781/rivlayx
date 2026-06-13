import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as authSchema from './schema/auth';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

const schema = { ...authSchema };

export interface DbHandle {
  db: Database;
  sql: ReturnType<typeof postgres>;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle handle backed by postgres-js. Caller owns lifecycle —
 * call `close()` when shutting down. Per-connection pool size is 10 by default;
 * pass `max` to override.
 */
export function createDb(url: string, options?: { max?: number }): DbHandle {
  const sql = postgres(url, {
    max: options?.max ?? 10,
    prepare: false,
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
