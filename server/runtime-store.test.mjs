import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseUrl } from './runtime-store.mjs';

test('local database configuration is explicit and never falls back to SQLite', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pingspace-env-'));
  try {
    await assert.rejects(databaseUrl({ env: {}, cwd }), /DATABASE_URL/);
    await writeFile(join(cwd, '.env.vercel.local'), 'DATABASE_URL="postgresql://cloud/test"\nVERCEL=1\n');
    const env = {};
    assert.equal(await databaseUrl({ env, cwd }), 'postgresql://cloud/test');
    assert.deepEqual(env, {}); // No production cookie flags leak into local HTTP.
    await writeFile(join(cwd, '.env.local'), 'DATABASE_URL="postgresql://local/test"\n');
    assert.equal(await databaseUrl({ env, cwd }), 'postgresql://local/test');
    assert.equal(await databaseUrl({ env: { DATABASE_URL: 'postgresql://explicit/test' }, cwd }), 'postgresql://explicit/test');
    await writeFile(join(cwd, '.env.local'), 'DATABASE_URL=""\n');
    assert.equal(await databaseUrl({ env, cwd }), 'postgresql://cloud/test');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
