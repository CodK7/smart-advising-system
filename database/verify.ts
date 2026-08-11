/**
 * Post-seed verification: `npm run db:verify`.
 *
 * The official login PDF is the source of truth for people and credentials.
 * Password plaintext is deliberately not stored in the repository; this check
 * verifies the exact official IDs, emails, roles, and precomputed scrypt hashes.
 */
import { createClient, type InArgs } from './sqlite.js';
import { loadEnvironment } from '../scripts/load-env.mjs';
import { ADMIN_ROLES, type ApplicationRole } from '../server/auth.js';
import { STAFF, STUDENTS } from './dataset.js';
import { assertDatasetIntegrity } from './integrity.js';
import { assertOfficialAccountState } from './official-accounts.js';
import { ensurePerformanceIndexes } from './performance-indexes.js';
import { localDatabaseUrl, resolveDatabasePath } from './path.js';

loadEnvironment();
const db = createClient({ url: localDatabaseUrl(resolveDatabasePath()) });
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const rows = async (sql: string, args: InArgs = []) => (await db.execute({ sql, args })).rows;
const queryPlan = async (sql: string, args: InArgs = []) =>
  (await rows(`EXPLAIN QUERY PLAN ${sql}`, args)).map((row) => String(row.detail));

async function mutationRejected(sql: string, args: InArgs = []): Promise<boolean> {
  const transaction = await db.transaction('write');
  try {
    await transaction.execute({ sql, args });
    return false;
  } catch {
    return true;
  } finally {
    await transaction.rollback().catch(() => undefined);
    transaction.close();
  }
}

async function main(): Promise<void> {
  await ensurePerformanceIndexes(db);
  assertDatasetIntegrity();
  const people = [...STAFF, ...STUDENTS];
  const expectedById = new Map(people.map((person) => [person.id, person]));

  console.log('\nDatabase metadata and integrity:\n');
  const quickCheck = await rows('PRAGMA quick_check');
  check('SQLite quick_check passes', quickCheck.length === 1 && String(quickCheck[0].quick_check) === 'ok');
  check('foreign-key enforcement is enabled', Number((await rows('PRAGMA foreign_keys'))[0].foreign_keys) === 1);
  check('no foreign-key violations', (await rows('PRAGMA foreign_key_check')).length === 0);
  check(
    'schema version is current',
    String((await rows("SELECT value FROM app_metadata WHERE key = 'schema_version'"))[0]?.value) === '6',
  );
  check(
    'credential source is the official login PDF',
    String((await rows("SELECT value FROM app_metadata WHERE key = 'credential_mode'"))[0]?.value) ===
      'official-pdf-scrypt',
  );
  check(
    'official account set is sealed',
    String((await rows("SELECT value FROM app_metadata WHERE key = 'identity_sealed'"))[0]?.value) === '1',
  );
  try {
    await assertOfficialAccountState(db, { checkCredentialHashes: true });
    check('authoritative account-state assertion passes', true);
  } catch (error) {
    check('authoritative account-state assertion passes', false, error instanceof Error ? error.message : String(error));
  }

  console.log('\nPerformance indexes and query plans:\n');
  const indexNames = new Set((await rows("SELECT name FROM sqlite_master WHERE type = 'index'"))
    .map((row) => String(row.name)));
  for (const index of [
    'idx_users_id_nocase',
    'idx_sessions_user_created',
    'idx_sessions_expires',
    'idx_messages_pair',
    'idx_messages_receiver_unread_sender',
    'idx_chat_user_recent',
  ]) {
    check(`performance index ${index} exists`, indexNames.has(index));
  }

  const loginPlan = await queryPlan(
    `SELECT id, name, email, phone, department, role, password_hash FROM users WHERE id = ? COLLATE NOCASE
     UNION ALL
     SELECT id, name, email, phone, department, role, password_hash FROM users WHERE email = ? COLLATE NOCASE
     LIMIT 1`,
    [STAFF[0].id, STAFF[0].email],
  );
  check('login query uses the ID and case-insensitive email indexes',
    loginPlan.some((detail) => detail.includes('SEARCH users USING INDEX idx_users_id_nocase')) &&
    loginPlan.some((detail) => detail.includes('SEARCH users USING INDEX sqlite_autoindex_users_2')),
  );
  const sessionPlan = await queryPlan(
    'SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token DESC LIMIT -1 OFFSET 9',
    [STUDENTS[0].id],
  );
  check('session retention query uses the ordered session index',
    sessionPlan.some((detail) => detail.includes('idx_sessions_user_created')),
  );
  const sessionPurgePlan = await queryPlan("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  check('expired-session purge uses the expiry index',
    sessionPurgePlan.some((detail) => detail.includes('idx_sessions_expires')),
  );
  const unreadPlan = await queryPlan(
    `SELECT m.sender_id, COUNT(*) AS count FROM messages m
     JOIN students s ON s.id = m.sender_id AND s.advisor_id = m.receiver_id
     WHERE m.receiver_id = ? AND m.is_read = 0 GROUP BY m.sender_id`,
    [STAFF.find((person) => person.role === 'Advisor')!.id],
  );
  check('unread-message query uses its covering index',
    unreadPlan.some((detail) => detail.includes('idx_messages_receiver_unread_sender')),
  );
  const messagePlan = await queryPlan(
    `SELECT * FROM (
       SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.is_read
       FROM messages m WHERE m.sender_id = ? AND m.receiver_id = ?
       UNION ALL
       SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.is_read
       FROM messages m WHERE m.sender_id = ? AND m.receiver_id = ?
       ORDER BY m.id DESC LIMIT 200
     ) recent ORDER BY id ASC`,
    [STUDENTS[0].id, STAFF.find((person) => person.role === 'Advisor')!.id, STAFF.find((person) => person.role === 'Advisor')!.id, STUDENTS[0].id],
  );
  check('conversation query uses pair indexes and only sorts the bounded response',
    messagePlan.filter((detail) => detail.includes('idx_messages_pair')).length === 2 &&
    messagePlan.filter((detail) => detail.includes('USE TEMP B-TREE FOR ORDER BY')).length === 1,
  );
  const chatPlan = await queryPlan(
    `SELECT * FROM (
       SELECT id, role, content, created_at FROM chat_messages
       WHERE user_id = ? ORDER BY id DESC LIMIT 100
     ) recent ORDER BY id ASC`,
    [STUDENTS[0].id],
  );
  check('chat-history query uses the newest-first user index',
    chatPlan.some((detail) => detail.includes('idx_chat_user_recent')),
  );
  const statsPlan = await queryPlan(
    `WITH student_stats AS (
       SELECT COUNT(*) AS total_students,
              COALESCE(SUM(gpa < ?), 0) AS at_risk_students,
              COALESCE(SUM(gpa >= ?), 0) AS good_standing_students,
              ROUND(AVG(gpa), 2) AS average_gpa
       FROM students
     )
     SELECT student_stats.total_students,
            (SELECT COUNT(*) FROM users WHERE role = 'Advisor') AS total_advisors
     FROM student_stats`,
    [2, 2],
  );
  check('stats query scans student aggregates once and uses the role index',
    statsPlan.filter((detail) => detail === 'SCAN students').length === 1 &&
    statsPlan.some((detail) => detail.includes('idx_users_role')),
  );
  const advisorLookupPlan = await queryPlan(
    `SELECT u.id, u.name, u.email, u.department, u.role FROM users u
     JOIN students s ON s.id = u.id WHERE s.advisor_id = ? ORDER BY u.name`,
    [STAFF.find((person) => person.role === 'Advisor')!.id],
  );
  check('advisor student lookup uses the advisor index',
    advisorLookupPlan.some((detail) => detail.includes('idx_students_advisor')),
  );
  const studentDetailPlan = await queryPlan(
    `SELECT u.id, u.name, u.email, u.phone, u.department, s.major, s.level, s.gpa,
            s.advisor_id, a.name AS advisor_name, a.department AS advisor_department
     FROM students s JOIN users u ON u.id = s.id
     LEFT JOIN users a ON a.id = s.advisor_id WHERE s.id = ?`,
    [STUDENTS[0].id],
  );
  check('student detail lookup uses primary-key joins',
    studentDetailPlan.filter((detail) => detail.includes('sqlite_autoindex_students_1')).length === 1 &&
    studentDetailPlan.filter((detail) => detail.includes('sqlite_autoindex_users_1')).length === 2,
  );

  console.log('\nOfficial user synchronization:\n');
  const actualUsers = await rows('SELECT id, name, email, phone, department, role, password_hash FROM users ORDER BY id');
  check('database contains exactly 16 official users', actualUsers.length === people.length, String(actualUsers.length));
  check('no duplicate email exists regardless of case', Number((await rows(
    'SELECT COUNT(*) c FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1)',
  ))[0].c) === 0);

  const allowedRoles: ApplicationRole[] = ['System Admin', 'Registrar Admin', 'Student Affairs Admin', 'Advisor', 'Student'];
  for (const row of actualUsers) {
    const expected = expectedById.get(String(row.id));
    check(`official account ${String(row.id)} exists`, Boolean(expected));
    if (!expected) continue;
    check(`${String(row.id)} email matches`, String(row.email).toLowerCase() === expected.email.toLowerCase());
    check(`${String(row.id)} name matches`, String(row.name) === expected.name);
    const expectedRole: ApplicationRole = 'role' in expected ? expected.role : 'Student';
    check(`${String(row.id)} role matches`, String(row.role) === expectedRole);
    check(`${String(row.id)} password hash matches official credential`, String(row.password_hash) === expected.passwordHash);
    check(`${String(row.id)} uses salted scrypt`, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(String(row.password_hash)));
    check(`${String(row.id)} has an allowed role`, allowedRoles.includes(String(row.role) as ApplicationRole));
  }
  check('all authoritative IDs are present', people.every((person) => actualUsers.some((row) => String(row.id) === person.id)));

  const roleExpectations: Array<[ApplicationRole, number]> = [
    ['System Admin', 1],
    ['Registrar Admin', 1],
    ['Student Affairs Admin', 1],
    ['Advisor', 5],
    ['Student', 8],
  ];
  for (const [role, expected] of roleExpectations) {
    const count = Number((await rows('SELECT COUNT(*) c FROM users WHERE role = ?', [role]))[0].c);
    check(`${role} count is ${expected}`, count === expected, String(count));
  }
  check('all three administrator roles are recognized', ADMIN_ROLES.length === 3);

  console.log('\nAcademic-account relationships:\n');
  const studentRows = await rows(
    `SELECT s.id, s.major, s.level, s.gpa, s.advisor_id, u.role advisor_role
       FROM students s LEFT JOIN users u ON u.id = s.advisor_id ORDER BY s.id`,
  );
  check('there are exactly 8 student academic records', studentRows.length === STUDENTS.length, String(studentRows.length));
  for (const student of STUDENTS) {
    const row = studentRows.find((candidate) => String(candidate.id) === student.id);
    check(`${student.id} academic row exists`, Boolean(row));
    if (!row) continue;
    check(`${student.id} major matches`, String(row.major) === student.major);
    check(`${student.id} level matches`, String(row.level) === student.level);
    check(`${student.id} deterministic demo GPA matches transcript`, Number(row.gpa) === student.gpa);
    check(`${student.id} advisor assignment matches`, String(row.advisor_id) === student.advisorId);
    check(`${student.id} advisor is an Advisor account`, String(row.advisor_role) === 'Advisor');
  }
  check(
    'student records belong only to Student accounts',
    Number((await rows("SELECT COUNT(*) c FROM students s JOIN users u ON u.id=s.id WHERE u.role <> 'Student'"))[0].c) === 0,
  );
  const demoGpaStats = await rows(
    'SELECT COUNT(*) total, SUM(gpa < 2) at_risk, SUM(gpa >= 2) good_standing, ROUND(AVG(gpa), 2) average_gpa FROM students',
  );
  check(
    'deterministic demo GPA distribution is retained',
    Number(demoGpaStats[0].total) === 8 && Number(demoGpaStats[0].at_risk) === 2 &&
      Number(demoGpaStats[0].good_standing) === 6 && Number(demoGpaStats[0].average_gpa) === 2.81,
  );
  check(
    'sessions contain no plaintext token columns',
    Number((await rows("SELECT COUNT(*) c FROM pragma_table_info('sessions') WHERE name IN ('raw_token','session_token')"))[0].c) === 0,
  );

  console.log('\nDatabase identity protections:\n');
  const triggerRows = await rows(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('users_protect_official_identity_before_update','users_protect_official_account_before_delete','users_reject_insert_when_identity_sealed')",
  );
  const triggers = new Set(triggerRows.map((row) => String(row.name)));
  check('official identity-update trigger exists', triggers.has('users_protect_official_identity_before_update'));
  check('official account-delete trigger exists', triggers.has('users_protect_official_account_before_delete'));
  check('sealed-account insert trigger exists', triggers.has('users_reject_insert_when_identity_sealed'));
  const sample = people[0];
  check(
    'official identity updates are rejected by SQLite',
    await mutationRejected('UPDATE users SET name = name WHERE id = ?', [sample.id]),
  );
  check(
    'official credential updates are rejected by SQLite',
    await mutationRejected('UPDATE users SET password_hash = password_hash WHERE id = ?', [sample.id]),
  );
  check(
    'official account deletion is rejected by SQLite',
    await mutationRejected('DELETE FROM users WHERE id = ?', [sample.id]),
  );
  check(
    'extra account insertion is rejected after sealing',
    await mutationRejected(
      `INSERT INTO users (id, name, email, department, role, password_hash)
       VALUES ('verification-only', 'Verification Only', 'verification-only@invalid.example',
               'Verification', 'Student', 'scrypt$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000')`,
    ),
  );

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
