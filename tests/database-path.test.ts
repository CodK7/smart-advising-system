import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localDatabaseUrl, resolveDatabasePath } from '../database/path.js';
import { createClient } from '../database/sqlite.js';

describe('database path safety', () => {
  it('uses an absolute local default and resolves relative paths', () => {
    expect(resolveDatabasePath('')).toBe(path.resolve('database.sqlite'));
    expect(resolveDatabasePath('data/test.db')).toBe(path.resolve('data/test.db'));
  });

  it('rejects URLs, network shares, null bytes, and unsupported extensions', () => {
    expect(() => resolveDatabasePath('https://example.com/database.sqlite')).toThrow(/local filesystem path/);
    expect(() => resolveDatabasePath('file:database.sqlite')).toThrow(/local filesystem path/);
    expect(() => resolveDatabasePath('\\\\server\\share\\database.sqlite')).toThrow(/network share/);
    expect(() => resolveDatabasePath('//server/share/database.sqlite')).toThrow(/network share/);
    expect(() => resolveDatabasePath('bad\0name.sqlite')).toThrow(/null byte/);
    expect(() => resolveDatabasePath('database.txt')).toThrow(/\.db/);
  });

  it('accepts a Windows drive-letter path without treating it as a URL scheme', () => {
    const windowsPath = 'C:\\Temp\\academic.sqlite';
    expect(() => resolveDatabasePath(windowsPath)).not.toThrow();
    expect(resolveDatabasePath(windowsPath)).toBe(path.resolve(windowsPath));
  });

  it('encodes file URL special characters and opens the result with the local SQLite adapter', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'codk7 db #'));
    const databasePath = path.join(temporaryDirectory, 'academic # smoke.sqlite');
    const url = localDatabaseUrl(databasePath);
    expect(url).toContain('%20');
    expect(url).toContain('%23');

    const client = createClient({ url });
    try {
      await client.execute('CREATE TABLE smoke_test (id INTEGER PRIMARY KEY)');
      await client.execute('INSERT INTO smoke_test DEFAULT VALUES');
      const result = await client.execute('SELECT COUNT(*) count FROM smoke_test');
      expect(Number(result.rows[0].count)).toBe(1);
    } finally {
      client.close();
      await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
