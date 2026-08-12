/** Ensure an empty Neon/PostgreSQL database is seeded once, never overwritten. */
import { spawnSync } from 'node:child_process';
import { createPostgresClient } from './postgres.js';
import { loadEnvironment } from '../scripts/load-env.mjs';

loadEnvironment();
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  const result = spawnSync(process.execPath, ['scripts/ensure-db.mjs'], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const db = createPostgresClient(connectionString);
  try {
    const table = await db.execute("SELECT to_regclass('public.app_metadata') AS table_name");
    if (!table.rows[0]?.table_name) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'database/postgres-seed.ts'], {
        stdio: 'inherit', shell: false, env: process.env,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exitCode = result.status ?? 1;
    } else {
      const version = await db.execute("SELECT value FROM app_metadata WHERE key = 'schema_version'");
      if (String(version.rows[0]?.value ?? '') !== '7') {
        throw new Error('PostgreSQL schema is out of date. Run an explicit reviewed migration; automatic resets are disabled.');
      }
      console.log('[DB] PostgreSQL database is ready (schema 7).');
    }
  } finally {
    db.close();
  }
}
