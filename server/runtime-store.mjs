import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createPostgresStore } from './postgres-store.mjs';

// Read only the database setting: Vercel's other settings (e.g. Secure cookies)
// must not change the behavior of a local HTTP server.
export async function databaseUrl({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.DATABASE_URL?.trim()) return env.DATABASE_URL.trim();
  for (const name of ['.env.local', '.env.vercel.local']) {
    try {
      const values = parseEnv(await readFile(resolve(cwd, name), 'utf8'));
      if (values.DATABASE_URL?.trim()) return values.DATABASE_URL.trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Не задан DATABASE_URL для Neon. Добавьте его в .env.local или выполните vercel env pull .env.vercel.local --environment=production.');
}

export async function createRuntimeStore(options) {
  return createPostgresStore({ connectionString: await databaseUrl(options) });
}
