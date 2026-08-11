import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

let port;
let base;
const candidates = [
  process.env.CHROME_PATH,
  process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
  process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('Chrome/Chromium was not found. Set CHROME_PATH to run browser smoke tests.');
}

let server;
let browser;
let serverOutput = '';
const tempDirectory = mkdtempSync(join(tmpdir(), 'codk7-browser-'));
const databasePath = join(tempDirectory, 'browser.sqlite');

const TEST_PASSWORD = 'Codk7-Browser-Test-2026!';
const scrypt = promisify(scryptCallback);

async function testPasswordHash() {
  const salt = randomBytes(16);
  const derived = await scrypt(TEST_PASSWORD.normalize('NFKC'), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function allocatePort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a browser-test port.');
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function stopServer() {
  if (!server?.pid) return;
  const exited = new Promise((resolvePromise) => server.once('exit', resolvePromise));
  try {
    if (process.platform === 'win32') server.kill('SIGTERM');
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    // The process may already have exited.
  }
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  if (server.exitCode === null && server.signalCode === null) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-server.pid, 'SIGKILL');
      }
    } catch {
      server.kill('SIGKILL');
    }
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  }
}

function cleanupTemporaryDirectory() {
  const resolvedDirectory = resolve(tempDirectory);
  const temporaryRoot = resolve(tmpdir());
  const pathWithinTemporaryRoot = relative(temporaryRoot, resolvedDirectory);
  if (
    !pathWithinTemporaryRoot ||
    pathWithinTemporaryRoot.startsWith('..') ||
    basename(resolvedDirectory).startsWith('codk7-browser-') === false
  ) {
    throw new Error(`Refusing to remove unverified browser-test directory: ${resolvedDirectory}`);
  }
  rmSync(resolvedDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Browser-test server did not start.\n${serverOutput.slice(-2_000)}`);
}

async function signIn(page, id, language = 'en') {
  const arabic = language === 'ar';
  await page.goto(base);
  await page.getByLabel(arabic ? 'الرقم الجامعي / الوظيفي أو البريد الإلكتروني' : 'Student / Staff ID or Email').fill(id);
  await page.getByLabel(arabic ? 'كلمة المرور' : 'Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: arabic ? 'تسجيل الدخول' : 'Sign in' }).click();
  if ((page.viewportSize()?.width ?? 1024) < 1024) {
    await page.getByRole('button', { name: arabic ? 'تبديل القائمة' : 'Toggle menu' }).waitFor();
  } else {
    await page.getByRole('button', { name: arabic ? 'تسجيل الخروج' : 'Sign out' }).waitFor();
  }
}

async function signOut(page, language = 'en') {
  const arabic = language === 'ar';
  if ((page.viewportSize()?.width ?? 1024) < 1024) {
    await page.getByRole('button', { name: arabic ? 'تبديل القائمة' : 'Toggle menu' }).click();
  }
  await page.getByRole('button', { name: arabic ? 'تسجيل الخروج' : 'Sign out' }).click();
  await page.getByRole('button', { name: arabic ? 'تسجيل الدخول' : 'Sign in' }).waitFor();
}

async function apiStatus(page, path, options = undefined) {
  return page.evaluate(
    async ({ requestPath, requestOptions }) => (await fetch(requestPath, requestOptions)).status,
    { requestPath: path, requestOptions: options },
  );
}

async function assertAdvisorComposerAligned(page, language = 'en') {
  const arabic = language === 'ar';
  const input = page.getByRole('textbox', { name: arabic ? 'رسالة إلى المستشار الذكي' : 'Message the AI advisor' });
  const send = page.getByRole('button', { name: arabic ? 'إرسال الرسالة' : 'Send message' });
  await input.waitFor();
  const [inputBox, sendBox] = await Promise.all([input.boundingBox(), send.boundingBox()]);
  if (!inputBox || !sendBox) throw new Error('AI advisor composer controls are not visible.');
  if (Math.abs(inputBox.height - sendBox.height) > 1 || Math.abs(inputBox.y - sendBox.y) > 1) {
    throw new Error('AI advisor composer input and Send button are not vertically aligned.');
  }
}

async function assertMessagesComposerAligned(page, language = 'en') {
  const arabic = language === 'ar';
  const input = page.getByRole('textbox', { name: arabic ? 'نص الرسالة' : 'Message text' });
  const send = page.getByRole('button', { name: arabic ? 'إرسال الرسالة' : 'Send message' });
  await input.waitFor();
  const [inputBox, sendBox] = await Promise.all([input.boundingBox(), send.boundingBox()]);
  if (!inputBox || !sendBox) throw new Error('Messaging composer controls are not visible.');
  if (Math.abs(inputBox.height - sendBox.height) > 1 || Math.abs(inputBox.y - sendBox.y) > 1) {
    throw new Error('Messaging composer input and Send button are not vertically aligned.');
  }
}

async function main() {
  port = await allocatePort();
  base = `http://127.0.0.1:${port}`;
  const passwordHash = await testPasswordHash();
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    GEMINI_API_KEY: '',
    DATABASE_PATH: databasePath,
    DISABLE_HMR: 'true',
    SAS_INTERNAL_TEST_PASSWORD_HASH: passwordHash,
  };
  execFileSync(process.execPath, ['--import', 'tsx', 'database/seed.ts'], {
    stdio: 'ignore',
    env: testEnvironment,
  });
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: { ...testEnvironment, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream?.on('data', (chunk) => {
      serverOutput = `${serverOutput}${String(chunk)}`.slice(-4_000);
    });
  }
  await waitForServer();

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('sas_language', 'en'));
  const page = await context.newPage();
  const browserErrors = [];
  const pendingDiagnostics = new Set();
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      browserErrors.push(`request: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    const expected =
      (url.pathname === '/api/me' && response.status() === 401) ||
      (url.pathname.startsWith('/.well-known/') && response.status() === 404) ||
      (response.status() === 403 && [
        '/api/admin/stats',
        '/api/admin/staff',
        '/api/admin/settings',
        '/api/admin/update-student',
      ].includes(url.pathname));
    if (response.status() >= 400 && !expected) {
      const diagnostic = response.text()
        .catch(() => '')
        .then((body) => {
          browserErrors.push(
            `response: ${response.status()} ${response.url()}${body ? ` ${body.slice(0, 500)}` : ''}`,
          );
        })
        .finally(() => pendingDiagnostics.delete(diagnostic));
      pendingDiagnostics.add(diagnostic);
    }
  });

  await page.goto(base);
  await page.evaluate(() => localStorage.setItem('currentUser', JSON.stringify({ id: 'attacker', role: 'System Admin' })));
  await page.reload();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  if (await page.getByText('attacker').count()) throw new Error('Forged localStorage identity was rendered.');

  await signIn(page, 'S26s3216');
  const seededProfile = await page.evaluate(async () => {
    const response = await fetch('/api/student/S26s3216/profile');
    if (!response.ok) throw new Error(`Profile API returned ${response.status}.`);
    return response.json();
  });
  const expectedGpa = Number(seededProfile.gpa).toFixed(2);
  const gpaValue = page.locator('[data-testid="student-overview-gpa"]');
  await gpaValue.waitFor();
  if ((await gpaValue.textContent())?.trim() !== expectedGpa) {
    throw new Error(`Student overview GPA did not match API value ${expectedGpa}.`);
  }
  await page.getByRole('button', { name: 'My Schedule' }).click();
  await page.getByText('The source data does not contain official meeting times or rooms').waitFor({ state: 'detached' }).catch(() => {});
  if (await page.getByText('The source data does not contain official meeting times or rooms').count()) {
    throw new Error('Student schedule still exposes the source-data implementation notice.');
  }
  await page.getByRole('button', { name: 'Study Plan' }).click();
  await page.getByText('Study plan', { exact: true }).waitFor();
  await page.getByText('Your study plan:', { exact: false }).waitFor();
  if (await page.getByRole('combobox', { name: 'Select a student' }).count()) {
    throw new Error('Student study-plan view exposes a student selector.');
  }
  if (await page.getByText('Official source data is unavailable or incomplete for:').count()) {
    throw new Error('Student study plan still exposes the source-data implementation notice.');
  }
  await page.getByRole('button', { name: 'AI Advisor' }).click();
  await assertAdvisorComposerAligned(page);
  if (await page.getByText('AI Advisor is in offline mode — responses may be less precise.').count()) {
    throw new Error('Student AI advisor still exposes the local-mode notice.');
  }
  await page.getByRole('button', { name: 'My GPA' }).click();
  await page.getByText('GPA progression', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Message Advisor' }).click();
  await assertMessagesComposerAligned(page);
  if (await apiStatus(page, '/api/admin/stats') !== 403) {
    throw new Error('Student was not denied access to institution statistics.');
  }
  await signOut(page);

  await signIn(page, '82e29746');
  await page.getByText('Assigned Students', { exact: true }).waitFor();
  await page.getByText('Information Technology', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'Study Plans' }).click();
  const advisorPlanSelector = page.getByRole('combobox', { name: 'Select a student' });
  await advisorPlanSelector.waitFor();
  const advisorPlanIds = await advisorPlanSelector.locator('option').evaluateAll((options) => options.map((option) => option.value));
  if (!advisorPlanIds.includes('S26s3216') || advisorPlanIds.includes('S26s3217')) {
    throw new Error('Advisor study-plan selector is not restricted to assigned students.');
  }
  await page.getByText('Plan for:', { exact: false }).waitFor();
  if (await page.getByText('Official source data is unavailable or incomplete for:').count()) {
    throw new Error('Advisor study-plan view still exposes the source-data implementation notice.');
  }
  await page.getByRole('button', { name: 'Messages' }).click();
  try {
    await page.getByRole('textbox', { name: 'Message text' }).waitFor({ timeout: 10_000 });
    await assertMessagesComposerAligned(page);
  } catch {
    throw new Error(`Advisor messaging did not load:\n${(await page.locator('body').innerText()).slice(0, 2_000)}`);
  }
  if (await apiStatus(page, '/api/admin/stats') !== 403) {
    throw new Error('Advisor was not denied access to institution statistics.');
  }
  await page.getByRole('button', { name: 'AI Advisor' }).click();
  await assertAdvisorComposerAligned(page);
  await signOut(page);

  await signIn(page, '32e87366');
  await page.getByText('Students', { exact: true }).first().waitFor();
  if (await page.getByText('System settings, institution-wide oversight, and read-only visibility of the official account roster.').count()) {
    throw new Error('System Admin informational banner is still visible.');
  }
  if (await page.getByRole('button', { name: 'University settings' }).count()) {
    throw new Error('System Admin settings navigation is still visible.');
  }
  await page.getByText('Academic Advisors', { exact: true }).waitFor();
  if (await page.getByText('Official account — view only').count()) {
    throw new Error('Advisor account-status column is still visible.');
  }
  await page.getByRole('button', { name: 'Student GPAs' }).click();
  await page.getByText('GPAs and academic standing', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Schedules' }).click();
  await page.getByText('Current registered courses', { exact: true }).waitFor();
  if (await page.getByText('The source data does not contain official meeting times or rooms').count()) {
    throw new Error('Admin schedule still exposes the source-data implementation notice.');
  }
  await page.getByRole('button', { name: 'Study Plans' }).click();
  await page.getByText('Study plan', { exact: true }).first().waitFor();
  const systemPlanIds = await page.getByRole('combobox', { name: 'Select a student' }).locator('option').evaluateAll((options) => options.map((option) => option.value));
  if (systemPlanIds.length !== 8) throw new Error('System Admin study-plan selector did not load all official students.');
  await page.getByRole('button', { name: 'AI Advisor' }).click();
  await assertAdvisorComposerAligned(page);
  await signOut(page);

  await signIn(page, '32e87367');
  await page.getByText('Students', { exact: true }).first().waitFor();
  if (await page.getByLabel('Registrar administrator dashboard').count()) {
    throw new Error('Registrar Admin informational banner is still visible.');
  }
  if (await page.getByText('Manage academic records, advisor assignments, and study-plan information.').count()) {
    throw new Error('Registrar Admin informational text is still visible.');
  }
  await page.getByText('Academic Advisors', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Study Plans' }).click();
  const registrarPlanIds = await page.getByRole('combobox', { name: 'Select a student' }).locator('option').evaluateAll((options) => options.map((option) => option.value));
  if (registrarPlanIds.length !== 8) throw new Error('Registrar Admin study-plan selector did not load all official students.');
  await page.getByRole('button', { name: 'AI Advisor' }).click();
  await assertAdvisorComposerAligned(page);
  if (await apiStatus(page, '/api/admin/staff') !== 200) {
    throw new Error('Registrar Admin could not load the staff roster.');
  }
  if (await apiStatus(page, '/api/admin/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ portal_notice: 'browser test' }),
  }) !== 403) {
    throw new Error('Registrar Admin was not denied System Admin settings changes.');
  }
  await signOut(page);

  await signIn(page, '32e87368');
  await page.getByText('Students', { exact: true }).first().waitFor();
  if (await page.getByLabel('Student affairs administrator dashboard').count()) {
    throw new Error('Student Affairs Admin informational banner is still visible.');
  }
  if (await page.getByText('Review student information and academic status without system or registrar mutation privileges.').count()) {
    throw new Error('Student Affairs Admin informational text is still visible.');
  }
  const affairsAdvisorHeading = page.getByText('Academic Advisors', { exact: true });
  await affairsAdvisorHeading.waitFor();
  const affairsAdvisorRows = affairsAdvisorHeading.locator('xpath=../..').locator('tbody tr');
  if (await affairsAdvisorRows.count() !== 5) {
    throw new Error('Student Affairs Admin advisor roster did not show all five official Advisor accounts.');
  }
  await page.getByRole('button', { name: 'Study Plans' }).click();
  const affairsPlanIds = await page.getByRole('combobox', { name: 'Select a student' }).locator('option').evaluateAll((options) => options.map((option) => option.value));
  if (affairsPlanIds.length !== 8) throw new Error('Student Affairs Admin study-plan selector did not load all official students.');
  await page.getByRole('button', { name: 'AI Advisor' }).click();
  await assertAdvisorComposerAligned(page);
  if (await apiStatus(page, '/api/admin/stats') !== 200) {
    throw new Error('Student Affairs Admin could not load institution statistics.');
  }
  if (await apiStatus(page, '/api/admin/advisors') !== 200) {
    throw new Error('Student Affairs Admin could not load the read-only advisor roster.');
  }
  if (await apiStatus(page, '/api/admin/staff') !== 403) {
    throw new Error('Student Affairs Admin was not denied full staff management.');
  }
  if (await apiStatus(page, '/api/admin/update-student', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'S26s3216', advisor_id: '82e29746' }),
  }) !== 403) {
    throw new Error('Student Affairs Admin was not denied registrar updates.');
  }
  await signOut(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '82e29746');
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.getByRole('button', { name: 'Messages' }).click();
  await assertMessagesComposerAligned(page);
  const advisorMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (advisorMobileOverflow) throw new Error('Advisor messaging overflows the mobile viewport.');
  await signOut(page);

  await signIn(page, 'S26s3216');
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.getByRole('button', { name: 'AI Advisor' }).click();
  await assertAdvisorComposerAligned(page);
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflows) throw new Error('Student dashboard overflows the mobile viewport.');
  await signOut(page);

  const rtlContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await rtlContext.addInitScript(() => localStorage.setItem('sas_language', 'ar'));
  const rtlPage = await rtlContext.newPage();
  await signIn(rtlPage, 'S26s3216', 'ar');
  await rtlPage.getByRole('button', { name: 'تبديل القائمة' }).click();
  await rtlPage.getByRole('button', { name: 'المستشار الذكي' }).click();
  await assertAdvisorComposerAligned(rtlPage, 'ar');
  const rtlOverflow = await rtlPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (rtlOverflow) throw new Error('Arabic RTL student dashboard overflows the mobile viewport.');
  await signOut(rtlPage, 'ar');
  await signIn(rtlPage, '82e29746', 'ar');
  await rtlPage.getByRole('button', { name: 'تبديل القائمة' }).click();
  await rtlPage.getByRole('button', { name: 'الرسائل' }).click();
  await assertMessagesComposerAligned(rtlPage, 'ar');
  const rtlAdvisorOverflow = await rtlPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (rtlAdvisorOverflow) throw new Error('Arabic RTL advisor messaging overflows the mobile viewport.');
  await rtlContext.close();

  await Promise.allSettled([...pendingDiagnostics]);
  if (browserErrors.length > 0) throw new Error(browserErrors.join('\n'));
  console.log('Browser smoke passed: all five roles, dashboards, logout, role boundaries, shared composers, banners, forged storage, and mobile viewport.');
}

main()
  .finally(async () => {
    await browser?.close().catch(() => {});
    await stopServer();
    cleanupTemporaryDirectory();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
