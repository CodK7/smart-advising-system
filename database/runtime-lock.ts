import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';

type LockOwner = 'server' | 'seeder';

type LockRecord = {
  version: 1;
  pid: number;
  host: string;
  owner: LockOwner;
  token: string;
  createdAt: string;
};

export type DatabaseRuntimeLock = {
  release(): Promise<void>;
};

export function databaseRuntimeLockPath(databasePath: string): string {
  return `${databasePath}.runtime-lock`;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

async function readRecord(lockPath: string): Promise<LockRecord | null> {
  try {
    const value = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<LockRecord>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.pid) ||
      typeof value.host !== 'string' ||
      (value.owner !== 'server' && value.owner !== 'seeder') ||
      typeof value.token !== 'string' ||
      typeof value.createdAt !== 'string'
    ) {
      return null;
    }
    return value as LockRecord;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    return null;
  }
}

/**
 * Prevent a running server and a database rebuild from targeting the same
 * SQLite file. A hard link publishes a fully-written lock record atomically,
 * avoiding a window where another process could observe partial JSON.
 */
export async function acquireDatabaseRuntimeLock(
  databasePath: string,
  owner: LockOwner,
): Promise<DatabaseRuntimeLock> {
  const lockPath = databaseRuntimeLockPath(databasePath);
  const token = randomUUID();
  const record: LockRecord = {
    version: 1,
    pid: process.pid,
    host: os.hostname(),
    owner,
    token,
    createdAt: new Date().toISOString(),
  };
  const candidatePath = `${lockPath}.candidate-${process.pid}-${token}`;
  await fs.writeFile(candidatePath, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.link(candidatePath, lockPath);
        return {
          async release() {
            const current = await readRecord(lockPath);
            if (current?.token === token) {
              await fs.unlink(lockPath).catch((error: unknown) => {
                if (!isErrno(error, 'ENOENT')) throw error;
              });
            }
          },
        };
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error;
      }

      const existing = await readRecord(lockPath);
      if (!existing) {
        throw new Error(
          `Database lock ${lockPath} is unreadable. Verify that no server or seeder is running before removing it.`,
        );
      }
      if (existing.host !== os.hostname()) {
        throw new Error(`Database is locked by ${existing.owner} on host ${existing.host}.`);
      }
      if (processIsRunning(existing.pid)) {
        throw new Error(`Database is in use by ${existing.owner} process ${existing.pid}.`);
      }

      const stalePath = `${lockPath}.stale-${process.pid}-${token}`;
      try {
        await fs.rename(lockPath, stalePath);
        await fs.unlink(stalePath);
      } catch (error) {
        if (!isErrno(error, 'ENOENT')) throw error;
      }
    }
    throw new Error(`Could not acquire database lock ${lockPath}.`);
  } finally {
    await fs.unlink(candidatePath).catch((error: unknown) => {
      if (!isErrno(error, 'ENOENT')) throw error;
    });
  }
}
