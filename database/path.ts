import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCAL_DATABASE_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);

/**
 * Resolve DATABASE_PATH as a plain local filesystem path.
 *
 * Remote libSQL URLs and UNC/network shares are deliberately rejected: this
 * application expects an embedded SQLite database and its seed/reset tools
 * must never operate on an unexpected remote target.
 */
export function resolveDatabasePath(value = process.env.DATABASE_PATH): string {
  const configured = value?.trim() || 'database.sqlite';
  if (configured.includes('\0')) throw new Error('DATABASE_PATH contains an invalid null byte.');
  if (/^[a-z][a-z\d+.-]*:/i.test(configured) && !/^[a-z]:[\\/]/i.test(configured)) {
    throw new Error('DATABASE_PATH must be a local filesystem path, not a URL.');
  }
  if (configured.startsWith('\\\\') || configured.startsWith('//')) {
    throw new Error('DATABASE_PATH must not reference a network share.');
  }

  const resolved = path.resolve(configured);
  if (!LOCAL_DATABASE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error('DATABASE_PATH must end in .db, .sqlite, or .sqlite3.');
  }
  return resolved;
}

/** Convert an already validated local path to the URL accepted by libSQL. */
export function localDatabaseUrl(databasePath: string): string {
  return pathToFileURL(databasePath).href;
}
