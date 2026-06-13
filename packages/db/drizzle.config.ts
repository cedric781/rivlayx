import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Config } from 'drizzle-kit';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '..', '..', '.env') });

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required (check rivlayx/.env)');
}

export default {
  schema: './src/schema/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
