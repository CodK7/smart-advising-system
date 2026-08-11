/** Full-stack authentication and five-role authorization regression suite. */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAFF, STUDENTS } from '../database/dataset.js';
import { hashSecret } from '../server/crypto.js';

const TEST_DIRECTORY = mkdtempSync(join(tmpdir(), 'codk7-api-'));
const TEST_DATABASE_PATH = join(TEST_DIRECTORY, 'integration.sqlite');
const TEST_PASSWORD = 'Codk7-Test-Password-2026!';
let server: ChildProcess | undefined;
let baseUrl = '';
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

class Session {
  private cookie = '';

  async request(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) as unknown : null; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }

  get(path: string) { return this.request('GET', path); }
  post(path: string, body?: unknown) { return this.request('POST', path, body); }
}

async function login(identifier: string): Promise<Session> {
  const session = new Session();
  const response = await session.post('/api/login', { identifier, password: TEST_PASSWORD });
  check(`${identifier} can authenticate`, response.status === 200, `status ${response.status}`);
  return session;
}

function mixedCaseId(identifier: string): string {
  return /[a-z]/i.test(identifier) ? identifier.toUpperCase() : identifier;
}

async function findPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate a port.'));
      const port = address.port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not start in time.');
}

async function prepareDatabase(): Promise<void> {
  const testHash = await hashSecret(TEST_PASSWORD);
  execFileSync(process.execPath, ['--import', 'tsx', 'database/seed.ts'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_PATH: TEST_DATABASE_PATH,
      SAS_INTERNAL_TEST_PASSWORD_HASH: testHash,
    },
  });
}

async function run(): Promise<void> {
  console.log('\nAuthentication and official account set:\n');
  const health = await fetch(`${baseUrl}/api/health`).then(async (response) => ({ status: response.status, data: await response.json() as unknown }));
  check('backend health reports server mode', health.status === 200 && record(health.data).mode === 'server');

  const anonymous = new Session();
  const invalid = await anonymous.post('/api/login', { identifier: STUDENTS[0].id, password: 'incorrect' });
  check('invalid password is rejected', invalid.status === 401 && record(invalid.data).code === 'INVALID_CREDENTIALS');
  check('anonymous protected request is rejected', (await anonymous.get('/api/admin/stats')).status === 401);

  const sessionsById = new Map<string, Session>();
  for (const person of [...STAFF, ...STUDENTS]) {
    const byId = await login(mixedCaseId(person.id));
    sessionsById.set(person.id, byId);
    const me = await byId.get('/api/me');
    const user = record(record(me.data).user);
    const expectedRole = 'role' in person ? person.role : 'Student';
    check(`${person.id} session has correct role`, user.id === person.id && user.role === expectedRole);
  }
  for (const person of [...STAFF, ...STUDENTS]) {
    const byEmail = await login(person.email);
    const user = record(record((await byEmail.get('/api/me')).data).user);
    const expectedRole = 'role' in person ? person.role : 'Student';
    check(`${person.email} email login resolves the correct account`, user.id === person.id && user.role === expectedRole);
  }
  const simultaneousLogins = await Promise.all([...STAFF, ...STUDENTS].map(async (person) => {
    const session = new Session();
    const response = await session.post('/api/login', { identifier: person.id, password: TEST_PASSWORD });
    const me = response.status === 200 ? await session.get('/api/me') : null;
    return response.status === 200 && me?.status === 200;
  }));
  check('all 16 official users can log in simultaneously', simultaneousLogins.every(Boolean));

  console.log('\nFive-role backend authorization:\n');
  const system = sessionsById.get('32e87366')!;
  const registrar = sessionsById.get('32e87367')!;
  const affairs = sessionsById.get('32e87368')!;
  const advisor = sessionsById.get('82e29746')!;
  const otherAdvisor = sessionsById.get('82e29747')!;
  const student = sessionsById.get('S26s3216')!;

  check('System Admin can read university settings', (await system.get('/api/settings')).status === 200);
  check('System Admin can read staff management', (await system.get('/api/admin/staff')).status === 200);
  check('Registrar Admin can read staff roster', (await registrar.get('/api/admin/staff')).status === 200);
  const advisorRosterForAffairs = await affairs.get('/api/admin/advisors');
  check(
    'Student Affairs Admin can read the five-advisor read-only roster',
    advisorRosterForAffairs.status === 200 && Array.isArray(advisorRosterForAffairs.data) &&
      advisorRosterForAffairs.data.length === 5 && advisorRosterForAffairs.data.every((row) => record(row).role === 'Advisor'),
  );
  check('System Admin can read the advisor roster', (await system.get('/api/admin/advisors')).status === 200);
  check('Registrar Admin can read the advisor roster', (await registrar.get('/api/admin/advisors')).status === 200);
  check('Registrar Admin cannot mutate system settings', (await registrar.post('/api/admin/settings', { portal_notice: 'test' })).status === 403);
  check('Student Affairs Admin cannot mutate system settings', (await affairs.post('/api/admin/settings', { portal_notice: 'test' })).status === 403);
  const institutionStats = await affairs.get('/api/admin/stats');
  const stats = record(institutionStats.data);
  check(
    'Student Affairs Admin receives complete institution statistics',
    institutionStats.status === 200 && stats.totalStudents === 8 && stats.totalAdvisors === 5 &&
      stats.totalAdmins === 3 && stats.totalMajors === 5 && stats.totalCourses === 110 &&
      stats.atRiskStudents === 2 && stats.goodStandingStudents === 6 && stats.averageGpa === 2.81,
  );
  check('Student Affairs Admin cannot read the full staff-management endpoint', (await affairs.get('/api/admin/staff')).status === 403);
  check('Student Affairs Admin cannot mutate staff accounts', (await affairs.post('/api/admin/update-staff', { id: '82e29746' })).status === 404);
  check(
    'Student Affairs Admin cannot mutate registrar-owned academic records',
    (await affairs.post('/api/admin/update-student', { id: STUDENTS[0].id, advisor_id: STAFF.find((person) => person.role === 'Advisor')!.id })).status === 403,
  );
  check(
    'Registrar Admin can update registrar-owned academic records',
    (await registrar.post('/api/admin/update-student', { id: STUDENTS[0].id, advisor_id: STUDENTS[0].advisorId })).status === 200,
  );
  const advisorRoster = await advisor.get('/api/admin/students');
  check(
    'Advisor roster exposes only assigned students for the study-plan selector',
    advisorRoster.status === 200 && Array.isArray(advisorRoster.data) &&
      advisorRoster.data.length > 0 && advisorRoster.data.every((row) => record(row).advisor_id === '82e29746'),
  );
  check('Advisor cannot read institution statistics', (await advisor.get('/api/admin/stats')).status === 403);

  const assignedDetail = await advisor.get('/api/admin/student/S26s3216/detail');
  check(
    'Advisor can read detail for an assigned student',
    assignedDetail.status === 200 && record(record(assignedDetail.data).profile).id === 'S26s3216' && Array.isArray(record(assignedDetail.data).studyPlan),
  );
  check(
    'Advisor cannot read detail for an unassigned student',
    (await advisor.get('/api/admin/student/S26s3217/detail')).status === 403,
  );
  check(
    'System Admin can read any student detail',
    (await system.get('/api/admin/student/S26s3217/detail')).status === 200,
  );
  check(
    'Student Affairs Admin can read student detail',
    (await affairs.get('/api/admin/student/S26s3217/detail')).status === 200,
  );
  check(
    'Student cannot use the staff student-detail endpoint',
    (await student.get('/api/admin/student/S26s3216/detail')).status === 403,
  );

  check(
    'Advisor can read advising for an assigned student through the staff route',
    (await advisor.get('/api/admin/student/S26s3216/advising')).status === 200,
  );
  check(
    'Advisor cannot read advising for an unassigned student through the staff route',
    (await advisor.get('/api/admin/student/S26s3217/advising')).status === 403,
  );
  check(
    'Advisor can read the published plan for an assigned student',
    (await advisor.get('/api/student/S26s3216/study-plan')).status === 200,
  );
  check(
    'Advisor cannot read the published plan for an unassigned student',
    (await advisor.get('/api/student/S26s3217/study-plan')).status === 403,
  );
  check(
    'Registrar Admin can read any student advising report',
    (await registrar.get('/api/admin/student/S26s3217/advising')).status === 200,
  );

  const createdNote = await advisor.post('/api/advisor/notes', { student_id: 'S26s3216', content: 'Integration note' });
  const createdNoteId = Number(record(createdNote.data).id);
  check('Advisor can add a note for an assigned student', createdNote.status === 200 && Number.isSafeInteger(createdNoteId));
  const advisorNotes = await advisor.get('/api/advisor/notes/S26s3216');
  check(
    'Advisor can read only their notes for an assigned student',
    advisorNotes.status === 200 && Array.isArray(advisorNotes.data) && advisorNotes.data.some((note) => record(note).id === createdNoteId),
  );
  check(
    'Advisor cannot add a note for an unassigned student',
    (await advisor.post('/api/advisor/notes', { student_id: 'S26s3217', content: 'Blocked note' })).status === 403,
  );
  check(
    'Another Advisor cannot read notes for a student not assigned to them',
    (await otherAdvisor.get('/api/advisor/notes/S26s3216')).status === 403,
  );
  check(
    'Administrators cannot read private Advisor notes',
    (await system.get('/api/advisor/notes/S26s3216')).status === 403,
  );
  check(
    'Another Advisor cannot delete a note they do not own',
    (await otherAdvisor.post('/api/advisor/notes/delete', { id: createdNoteId })).status === 404,
  );
  check(
    'Advisor can delete their own note',
    (await advisor.post('/api/advisor/notes/delete', { id: createdNoteId })).status === 200,
  );

  const sentMessage = await student.post('/api/messages', { receiver_id: '82e29746', content: 'Performance regression message' });
  check('Student can send an advisor message through the scoped relationship query', sentMessage.status === 200);
  const advisorConversation = await advisor.get('/api/messages?with=S26s3216');
  check(
    'Advisor conversation query returns the scoped message',
    advisorConversation.status === 200 && Array.isArray(advisorConversation.data) &&
      advisorConversation.data.some((message) => record(message).content === 'Performance regression message'),
  );
  const advisorUnread = await advisor.get('/api/messages/unread');
  check(
    'Advisor unread counts return the student message',
    advisorUnread.status === 200 && Array.isArray(advisorUnread.data) &&
      advisorUnread.data.some((count) => record(count).sender_id === 'S26s3216' && Number(record(count).count) === 1),
  );
  check('Advisor can mark the scoped message as read', (await advisor.post('/api/messages/read', { senderId: 'S26s3216' })).status === 200);

  check('Student can read their own profile', (await student.get('/api/student/S26s3216/profile')).status === 200);
  check('Student cannot read another student profile', (await student.get('/api/student/S26s3217/profile')).status === 403);
  check('Student can read only their own published plan', (await student.get('/api/student/S26s3216/study-plan')).status === 200);
  check('Student cannot read another student published plan', (await student.get('/api/student/S26s3217/study-plan')).status === 403);
  check('Registrar Admin can read any selected student published plan', (await registrar.get('/api/student/S26s3217/study-plan')).status === 200);
  check('Student Affairs Admin can read any selected student published plan', (await affairs.get('/api/student/S26s3217/study-plan')).status === 200);
  for (const [studentId, major] of [
    ['S26s3216', 'Cyber and Information Security'],
    ['S26s3219', 'Data Science and Artificial Intelligence'],
  ]) {
    const plan = await system.get(`/api/student/${studentId}/study-plan`);
    const planRows = Array.isArray(plan.data) ? plan.data.map(record) : [];
    check(
      `${major} does not receive the Network Computing Diploma Second Year plan`,
      plan.status === 200 && !planRows.some((row) => row.level === 'Diploma Second Year' || row.code === 'CSNW2102'),
    );
    const advising = await system.get(`/api/admin/student/${studentId}/advising`);
    const status = record(record(advising.data).planDataStatus);
    check(
      `${major} advising reports its unavailable official plan data`,
      advising.status === 200 && status.available === false && Array.isArray(status.unavailableLevels) && status.unavailableLevels.includes('Diploma Second Year'),
    );
  }
  const incompletePlanChat = await student.post('/api/chat', { message: 'plan' });
  check(
    'AI fallback reports incomplete source data instead of another major curriculum',
    incompletePlanChat.status === 200 && String(record(incompletePlanChat.data).reply).includes('incomplete'),
  );
  const chatHistory = await student.get('/api/chat/history');
  check(
    'chat history returns the persisted user and advisor messages',
    chatHistory.status === 200 && Array.isArray(chatHistory.data) && chatHistory.data.length >= 2,
  );
  check('Student cannot access admin endpoints', (await student.get('/api/admin/stats')).status === 403);
  check('anonymous institution statistics request is rejected', (await anonymous.get('/api/admin/stats')).status === 401);
  check(
    'official-account deletion endpoint is not exposed',
    (await system.post('/api/admin/delete-user', { id: STUDENTS[1].id })).status === 404,
  );
  check(
    'official staff identity mutation endpoint is not exposed',
    (await system.post('/api/admin/update-staff', { id: STAFF[3].id, email: 'changed@example.invalid' })).status === 404,
  );
  check(
    'official password-rotation endpoint is not exposed',
    (await system.post('/api/set-password', { currentPassword: TEST_PASSWORD, password: 'Different-Test-Password-2026!' })).status === 404,
  );

  const studentList = await system.get('/api/admin/students');
  check('administrator sees exactly 8 official students', studentList.status === 200 && Array.isArray(studentList.data) && studentList.data.length === 8);
  const staffList = await system.get('/api/admin/staff');
  check('staff endpoint exposes exactly 8 official staff accounts', staffList.status === 200 && Array.isArray(staffList.data) && staffList.data.length === 8);
  const unavailablePlanUpdate = await registrar.post('/api/admin/update-student', {
    id: 'S26s3216',
    level: 'Diploma Second Year',
  });
  check(
    'Registrar cannot assign courses for an unavailable official study plan',
    unavailablePlanUpdate.status === 400 && record(unavailablePlanUpdate.data).code === 'MISSING_STUDY_PLAN',
  );
  const cyberProfile = await system.get('/api/student/S26s3216/profile');
  check(
    'Rejected unavailable-plan update leaves the official student record unchanged',
    cyberProfile.status === 200 && record(cyberProfile.data).level === 'Advanced Diploma',
  );

  console.log('\nSession and response security:\n');
  const me = await system.get('/api/me');
  check('session response contains no password material', !JSON.stringify(me.data).toLowerCase().includes('password'));
  check('authenticated API responses are not cached', me.headers.get('cache-control') === 'no-store');
  check('logout succeeds', (await student.post('/api/logout')).status === 200);
  check('logout invalidates the session', (await student.get('/api/me')).status === 401);
}

async function main(): Promise<void> {
  try {
    await prepareDatabase();
    const port = await findPort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      env: { ...process.env, NODE_ENV: 'test', SAS_INTERNAL_API_ONLY: '1', PORT: String(port), DATABASE_PATH: TEST_DATABASE_PATH, GEMINI_API_KEY: '' },
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });
    await waitForServer();
    await run();
  } finally {
    if (server?.pid) {
      try { process.kill(process.platform === 'win32' ? server.pid : -server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
    }
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    rmSync(TEST_DIRECTORY, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
