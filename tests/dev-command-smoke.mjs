import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'codk7-dev-command-'));
const databasePath = join(temporaryDirectory, 'development.sqlite');
let npmProcess;
let output = '';

async function assertPortAvailable() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(PORT, '127.0.0.1', resolvePromise);
  });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
}

async function stopProcessTree() {
  if (!npmProcess?.pid || npmProcess.exitCode !== null || npmProcess.signalCode !== null) return;
  const exited = new Promise((resolvePromise) => npmProcess.once('exit', resolvePromise));
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(npmProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-npmProcess.pid, 'SIGTERM');
    }
  } catch {
    npmProcess.kill('SIGKILL');
  }
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
}

function cleanup() {
  const temporaryRoot = resolve(tmpdir());
  const target = resolve(temporaryDirectory);
  const relativePath = relative(temporaryRoot, target);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !basename(target).startsWith('codk7-dev-command-')
  ) {
    throw new Error(`Refusing to remove unsafe dev-smoke path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (npmProcess?.exitCode !== null || npmProcess?.signalCode !== null) break;
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // npm/predev/server are still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`npm run dev did not start on port ${PORT}.\n${output.slice(-3_000)}`);
}

async function main() {
  await assertPortAvailable();
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is unavailable; run this smoke test through npm.');
  npmProcess = spawn(process.execPath, [npmCli, 'run', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Deliberately stale values prove the scripts force development + 5173.
      NODE_ENV: 'production',
      PORT: '9999',
      APP_HOST: '127.0.0.1',
      APP_ORIGIN: 'http://localhost:5173',
      DATABASE_PATH: databasePath,
      GEMINI_API_KEY: '',
      DISABLE_HMR: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  for (const stream of [npmProcess.stdout, npmProcess.stderr]) {
    stream?.on('data', (chunk) => {
      output = `${output}${String(chunk)}`.slice(-6_000);
    });
  }
  await waitForServer();
  const entry = await fetch(`${BASE_URL}/`);
  const html = await entry.text();
  if (!entry.ok || !html.includes('id="root"') || /This page has to be started by its server/i.test(html)) {
    throw new Error('The development entry page is invalid or still contains the direct-file warning.');
  }
  console.log('npm run dev smoke passed on http://localhost:5173 with isolated local-mode data.');
}

main()
  .finally(async () => {
    await stopProcessTree();
    cleanup();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
