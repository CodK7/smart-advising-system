/** Seed an empty PostgreSQL database from the same deterministic demo dataset. */
import fs from 'node:fs';
import path from 'node:path';
import { createPostgresClient } from './postgres.js';
import { populateDatabase, type Gap } from './seed.js';
import { loadEnvironment } from '../scripts/load-env.mjs';
import { assertDatasetIntegrity } from './integrity.js';

loadEnvironment();

const connectionString = process.env.DATABASE_URL?.trim() || '';
if (!connectionString) throw new Error('DATABASE_URL is required to seed PostgreSQL.');

async function main(): Promise<void> {
  assertDatasetIntegrity();
  const db = createPostgresClient(connectionString);
  try {
    const existing = await db.execute("SELECT to_regclass('public.app_metadata') AS table_name");
    if (existing.rows[0]?.table_name) {
      const sealed = await db.execute("SELECT value FROM app_metadata WHERE key = 'identity_sealed'");
      if (String(sealed.rows[0]?.value ?? '') === '1') {
        throw new Error('PostgreSQL database is already initialized; refusing to overwrite persistent data.');
      }
    }
    await db.executeMultiple(fs.readFileSync(path.resolve('database/schema.postgres.sql'), 'utf8'));
    const gaps: Gap[] = [];
    const transaction = await db.transaction('write');
    try {
      await populateDatabase(transaction, gaps, '7');
      await transaction.commit();
    } finally {
      transaction.close();
    }
    console.log(`PostgreSQL database seeded successfully${gaps.length ? ` with ${gaps.length} dataset notice(s)` : ''}.`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('PostgreSQL seed failed:', error);
  process.exitCode = 1;
});
