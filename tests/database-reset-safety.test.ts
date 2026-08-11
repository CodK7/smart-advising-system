import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  );
});

function runProductionReset(databasePath: string, allowInitialSeed = false) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'database/seed.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_PATH: databasePath,
      ...(allowInitialSeed ? { SAS_INTERNAL_PRODUCTION_INITIAL_SEED: '1' } : {}),
    },
    encoding: 'utf8',
  });
}

describe('production database reset safety', () => {
  it('refuses a direct production reset', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sas-reset-test-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'production.sqlite');

    const result = runProductionReset(databasePath);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Refusing to reset a production database/);
  });

  it('does not trust an initial-seed marker when the target already exists', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sas-reset-test-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'production.sqlite');
    const sentinel = Buffer.from('do-not-replace');
    await writeFile(databasePath, sentinel);

    const result = runProductionReset(databasePath, true);
    expect(result.status).not.toBe(0);
    expect(await readFile(databasePath)).toEqual(sentinel);
  });
});
