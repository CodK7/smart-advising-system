import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'codk7-production-'));
const databasePath = join(temporaryDirectory, 'production.sqlite');
let server;
let serverOutput = '';

async function allocatePort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a production-smoke port.');
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolvePromise) => server.once('exit', resolvePromise));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  if (server.exitCode === null && server.signalCode === null) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(server.pid, 'SIGKILL');
      }
    } catch {
      server.kill('SIGKILL');
    }
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  }
}

function cleanup() {
  const temporaryRoot = resolve(tmpdir());
  const target = resolve(temporaryDirectory);
  const relativePath = relative(temporaryRoot, target);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !basename(target).startsWith('codk7-production-')
  ) {
    throw new Error(`Refusing to remove unsafe production-smoke path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForHealth(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (server?.exitCode !== null || server?.signalCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Production server did not start.\n${serverOutput.slice(-2_000)}`);
}

async function main() {
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    APP_HOST: '127.0.0.1',
    APP_ORIGIN: 'https://advising.example.test',
    DATABASE_PATH: databasePath,
    GEMINI_API_KEY: '',
    TRUST_PROXY: 'false',
  };

  execFileSync(process.execPath, ['scripts/ensure-db.mjs'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'ignore',
  });
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on('data', (chunk) => {
      serverOutput = `${serverOutput}${String(chunk)}`.slice(-4_000);
    });
  }

  const health = await waitForHealth(baseUrl);
  const index = await fetch(`${baseUrl}/`);
  const html = await index.text();
  const assetPath = html.match(/\/assets\/[^"']+\.js/)?.[0];
  if (!index.ok || !assetPath) throw new Error('Production SPA entry or hashed asset reference is missing.');
  const asset = await fetch(`${baseUrl}${assetPath}`);
  if (!asset.ok) throw new Error(`Production asset returned ${asset.status}.`);
  if (!/no-store/i.test(health.headers.get('cache-control') ?? '')) {
    throw new Error('Protected API responses must use Cache-Control: no-store.');
  }
  if (!/immutable/i.test(asset.headers.get('cache-control') ?? '')) {
    throw new Error('Hashed production assets must use immutable caching.');
  }
  console.log('Production smoke passed: isolated seed/start, SPA fallback, no-store API, immutable assets.');
}

main()
  .finally(async () => {
    await stopServer();
    cleanup();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
