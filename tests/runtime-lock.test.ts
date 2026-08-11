import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireDatabaseRuntimeLock,
  databaseRuntimeLockPath,
} from '../database/runtime-lock.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  );
});

describe('database runtime lock', () => {
  it('prevents a seeder from replacing a database held by the server', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sas-lock-test-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'app.sqlite');
    const serverLock = await acquireDatabaseRuntimeLock(databasePath, 'server');

    await expect(acquireDatabaseRuntimeLock(databasePath, 'seeder')).rejects.toThrow(/in use/i);
    await serverLock.release();

    const seederLock = await acquireDatabaseRuntimeLock(databasePath, 'seeder');
    await seederLock.release();
  });

  it('reclaims a valid lock whose process no longer exists', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sas-lock-test-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'app.sqlite');
    await writeFile(
      databaseRuntimeLockPath(databasePath),
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        host: os.hostname(),
        owner: 'server',
        token: 'stale-token',
        createdAt: new Date(0).toISOString(),
      }),
      'utf8',
    );

    const lock = await acquireDatabaseRuntimeLock(databasePath, 'seeder');
    await lock.release();
  });
});
