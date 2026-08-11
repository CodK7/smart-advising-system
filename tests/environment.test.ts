import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const loaderUrl = pathToFileURL(path.resolve('scripts/load-env.mjs')).href;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    ),
  );
});

function runLoader(cwd: string, nodeEnv: string) {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: nodeEnv,
    SAS_ENV_A: 'shell',
  };
  delete childEnvironment.SAS_ENV_B;
  delete childEnvironment.SAS_ENV_C;
  const script = `
    import { loadEnvironment } from ${JSON.stringify(loaderUrl)};
    loadEnvironment();
    process.stdout.write(JSON.stringify({
      a: process.env.SAS_ENV_A,
      b: process.env.SAS_ENV_B,
      c: process.env.SAS_ENV_C,
    }));
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    env: childEnvironment,
    encoding: 'utf8',
  });
}

describe('shared environment loading', () => {
  it('uses shell > .env.local > .env in development', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sas-env-test-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, '.env'), 'SAS_ENV_A=base\nSAS_ENV_B=base\n', 'utf8');
    await writeFile(path.join(directory, '.env.local'), 'SAS_ENV_B=local\nSAS_ENV_C=local\n', 'utf8');

    const result = runLoader(directory, 'development');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ a: 'shell', b: 'local', c: 'local' });
  });

  it('ignores .env.local in production', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sas-env-test-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, '.env'), 'SAS_ENV_B=base\n', 'utf8');
    await writeFile(path.join(directory, '.env.local'), 'SAS_ENV_B=local\nSAS_ENV_C=local\n', 'utf8');

    const result = runLoader(directory, 'production');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ a: 'shell', b: 'base' });
  });
});
