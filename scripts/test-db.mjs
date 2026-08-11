/** Build and verify an isolated test database without touching database.sqlite. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.realpathSync(os.tmpdir());
const temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'codk7-test-db-'));
const databasePath = path.join(temporaryDirectory, 'academic.sqlite');

function run(scriptPath) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${scriptPath} exited with code ${result.status ?? 'unknown'}.`);
  }
}

function removeOwnedTemporaryDirectory() {
  const relative = path.relative(temporaryRoot, temporaryDirectory);
  const isOwnedChild = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) &&
    path.basename(temporaryDirectory).startsWith('codk7-test-db-');
  if (!isOwnedChild) throw new Error('Refusing to clean an unverified temporary database path.');
  fs.rmSync(temporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

try {
  run('database/seed.ts');
  run('database/verify.ts');
  console.log('[test:db] Isolated database checks passed.');
} catch (error) {
  console.error('[test:db] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  removeOwnedTemporaryDirectory();
}
