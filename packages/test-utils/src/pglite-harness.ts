import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '..', '..', 'db', 'migrations');

export interface TestDb {
  /** Drizzle database handle (pglite driver). Same query API as production. */
  db: ReturnType<typeof drizzle>;
  /** Raw PGlite handle, for low-level SQL when needed. */
  pg: PGlite;
  /** Shut down the in-memory instance. */
  close: () => Promise<void>;
}

/**
 * Spin up an in-process Postgres (PGlite/WASM, PG16-compatible) and apply
 * every migration in `packages/db/migrations/`. Returns a Drizzle handle
 * that backs both unit and integration tests without any Docker dependency.
 *
 * Each call returns a fresh isolated instance.
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.waitReady;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    // Drizzle migrations use `--> statement-breakpoint` between statements.
    // PGlite's exec accepts multiple statements but choke on a few constructs
    // (e.g. nested DO blocks). Split-and-execute is the safe path.
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await pg.exec(statement);
    }
  }

  const db = drizzle(pg);
  return {
    db,
    pg,
    close: async () => {
      await pg.close();
    },
  };
}
