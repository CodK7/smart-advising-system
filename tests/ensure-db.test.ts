import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('database startup safety', () => {
  it('never replaces an unreadable existing production database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'codk7-production-db-'));
    const databasePath = path.join(directory, 'production.sqlite');
    const sentinel = Buffer.from('existing-production-data');
    writeFileSync(databasePath, sentinel);

    try {
      const result = spawnSync(process.execPath, ['scripts/ensure-db.mjs'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_ORIGIN: 'https://advising.example.edu',
          DATABASE_PATH: databasePath,
          NODE_ENV: 'production',
        },
      });

      expect(result.status).toBe(1);
      expect(readFileSync(databasePath)).toEqual(sentinel);
      expect(result.stderr).toContain('Production databases are never rebuilt automatically');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
