// Ensure the embedded SQLite database exists before the application starts.
// Existing databases are left untouched; a missing one is created by the
// project's deterministic TypeScript seeder.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from './load-env.mjs';

loadEnvironment();

const EXPECTED_SCHEMA_VERSION = '6';
const configuredPath = process.env.DATABASE_PATH?.trim() || 'database.sqlite';
if (configuredPath.includes('\0')) throw new Error('DATABASE_PATH contains an invalid null byte.');
if (/^[a-z][a-z\d+.-]*:/i.test(configuredPath) && !/^[a-z]:[\\/]/i.test(configuredPath)) {
  throw new Error('DATABASE_PATH must be a local filesystem path, not a URL.');
}
if (configuredPath.startsWith('\\\\') || configuredPath.startsWith('//')) {
  throw new Error('DATABASE_PATH must not reference a network share.');
}

const databasePath = path.resolve(configuredPath);
if (!new Set(['.db', '.sqlite', '.sqlite3']).has(path.extname(databasePath).toLowerCase())) {
  throw new Error('DATABASE_PATH must end in .db, .sqlite, or .sqlite3.');
}
const databaseUrl = pathToFileURL(databasePath).href;
const displayPath = path.relative(process.cwd(), databasePath) || path.basename(databasePath);
const versionCheck = `
  import { DatabaseSync } from 'node:sqlite';
  import { fileURLToPath } from 'node:url';
  const db = new DatabaseSync(fileURLToPath(${JSON.stringify(databaseUrl)}));
  try {
    const rows = db.prepare("SELECT key, value FROM app_metadata WHERE key IN ('schema_version', 'credential_mode', 'identity_sealed')").all();
    const metadata = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
    process.stdout.write(String(metadata.schema_version ?? '') + '|' + String(metadata.credential_mode ?? '') + '|' + String(metadata.identity_sealed ?? ''));
  } finally {
    db.close();
  }
`;

const databaseExists = existsSync(databasePath);
if (databaseExists) {
  // Check in a short-lived child so the native SQLite handle is guaranteed to
  // be gone before a stale database is replaced (especially important on
  // Windows and OneDrive-backed workspaces).
  const check = spawnSync(process.execPath, ['--input-type=module', '--eval', versionCheck], {
    encoding: 'utf8',
  });
  const [schemaVersion, credentialMode, identitySealed] = check.stdout.trim().split('|');
  const ready = check.status === 0 &&
    schemaVersion === EXPECTED_SCHEMA_VERSION &&
    identitySealed === '1' &&
    (process.env.NODE_ENV !== 'production' || credentialMode === 'official-pdf-scrypt');
  if (ready) {
    console.log(`[DB] ${displayPath} is ready (schema ${EXPECTED_SCHEMA_VERSION}).`);
    process.exit(0);
  }
  if (process.env.NODE_ENV === 'production') {
    const reason = check.status === 0
      ? `schema=${schemaVersion || 'unknown'}, credentials=${credentialMode || 'unknown'}, identity_sealed=${identitySealed || 'unknown'}`
      : 'the database could not be read';
    console.error(
      `[DB] ${displayPath} is not production-ready (${reason}). ` +
      'Production databases are never rebuilt automatically; back it up and run an explicit migration, ' +
      'or point DATABASE_PATH at a new empty location.',
    );
    process.exit(1);
  }
  console.log(`[DB] ${displayPath} is stale; rebuilding it safely...`);
} else {
  console.log(`[DB] ${displayPath} is missing; building it now...`);
}
// On Windows the embedded driver can release its file handle a moment after
// close() returns. Give it one event-loop turn before the seeder replaces an
// outdated database.
if (process.platform === 'win32') {
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const result = spawnSync(process.execPath, ['--import', 'tsx', 'database/seed.ts'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    ...(databaseExists ? {} : { SAS_INTERNAL_PRODUCTION_INITIAL_SEED: '1' }),
  },
});

if (result.error) {
  console.error('[DB] Could not start the database seeder:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
