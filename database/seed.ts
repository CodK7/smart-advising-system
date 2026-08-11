/**
 * Database builder.
 *
 *   npm run db:reset    rebuild database.sqlite and print source-data gaps
 *
 * Credentials are hashed here rather than in a .sql file because a salted hash
 * cannot be written as a literal. Reference data (majors, courses, plans)
 * comes only from database/dataset.ts.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from './sqlite.js';
import { gradesForTarget } from '../server/academic.js';
import { loadEnvironment } from '../scripts/load-env.mjs';
import { assertDatasetIntegrity } from './integrity.js';
import { localDatabaseUrl, resolveDatabasePath } from './path.js';
import { acquireDatabaseRuntimeLock } from './runtime-lock.js';
import {
  COURSE_META,
  COURSE_TITLES,
  ELECTIVE_CODES,
  ELECTIVE_POOLS,
  LEVEL_ORDER,
  MAJORS,
  PREREQUISITES,
  SOURCE_CONFLICTS,
  STAFF,
  STUDENTS,
  STUDY_PLANS,
  levelIndex,
  semesterOf,
  studyPlanSourceFor,
  type Level,
} from './dataset.js';

loadEnvironment();

const DB_FILE = resolveDatabasePath();
const DIRECT_BUILD = process.env.SAS_INTERNAL_DIRECT_SEED === '1';
const INITIAL_PRODUCTION_SEED = process.env.SAS_INTERNAL_PRODUCTION_INITIAL_SEED === '1';
const INTERNAL_TEST_PASSWORD_HASH = process.env.SAS_INTERNAL_TEST_PASSWORD_HASH?.trim();
const SCRYPT_HASH = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i;

if (INTERNAL_TEST_PASSWORD_HASH && process.env.NODE_ENV !== 'test') {
  throw new Error('SAS_INTERNAL_TEST_PASSWORD_HASH is accepted only when NODE_ENV=test.');
}
if (INTERNAL_TEST_PASSWORD_HASH && !SCRYPT_HASH.test(INTERNAL_TEST_PASSWORD_HASH)) {
  throw new Error('SAS_INTERNAL_TEST_PASSWORD_HASH must be a valid salted scrypt hash.');
}
const credentialMode = INTERNAL_TEST_PASSWORD_HASH ? 'test-fixture-scrypt' : 'official-pdf-scrypt';
const credentialHash = (officialHash: string) => INTERNAL_TEST_PASSWORD_HASH ?? officialHash;

if (process.env.NODE_ENV === 'production' && !DIRECT_BUILD) {
  if (!INITIAL_PRODUCTION_SEED || fs.existsSync(DB_FILE)) {
    throw new Error(
      'Refusing to reset a production database. Stop the server, back up the database, and use an explicit migration.',
    );
  }
}

/** The term the system considers "now". Terms before it are historical. */
const CURRENT_TERM_INDEX = 0;

/** Term name for an offset relative to the current term (0 = current). */
function termName(offset: number): string {
  // Academic year runs Fall -> Spring. Current term is Spring 2026.
  const stepsBack = -offset;
  const baseIsSpring = true;
  const baseYear = 2026;
  const isSpring = stepsBack % 2 === 0 ? baseIsSpring : !baseIsSpring;
  const yearsBack = Math.floor((stepsBack + (baseIsSpring ? 0 : 1)) / 2);
  const year = isSpring ? baseYear - yearsBack : baseYear - yearsBack - 1;
  return `${isSpring ? 'Spring' : 'Fall'} ${year}`;
}

/**
 * The ordered sequence of (level, semester) terms a student in `major` passes
 * through, from the shared first year up to and including `level`.
 */
function termSequence(major: string, level: Level): { level: Level; semester: 1 | 2 }[] {
  const out: { level: Level; semester: 1 | 2 }[] = [];
  const target = levelIndex(level);
  for (let i = 0; i <= target; i++) {
    const lvl = LEVEL_ORDER[i];
    if (planCodesFor(major, lvl).length === 0) continue;
    out.push({ level: lvl, semester: 1 }, { level: lvl, semester: 2 });
  }
  return out;
}

function planCodesFor(major: string, level: Level): string[] {
  const sourceMajor = studyPlanSourceFor(major, level);
  return sourceMajor ? (STUDY_PLANS[sourceMajor]?.[level] ?? []) : [];
}

function coursesFor(major: string, level: Level, semester: 1 | 2): string[] {
  const codes = planCodesFor(major, level);
  return codes.filter((c) => plannedSemester(codes, c) === semester);
}

/**
 * Semester for a course within a plan. Real codes encode it; elective
 * placeholders are spread evenly so each semester carries a sensible load.
 */
function plannedSemester(planCodes: string[], code: string): 1 | 2 {
  if (!ELECTIVE_CODES.has(code)) return semesterOf(code);
  const electives = planCodes.filter((c) => ELECTIVE_CODES.has(c));
  const idx = electives.indexOf(code);
  return idx < Math.ceil(electives.length / 2) ? 1 : 2;
}

interface Gap {
  kind: string;
  detail: string;
}

async function removeDatabaseArtifact(filePath: string): Promise<void> {
  for (let attempt = 0; attempt <= 10; attempt++) {
    try {
      await fs.promises.rm(filePath, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '') || attempt === 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function renameDatabaseArtifact(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt <= 10; attempt++) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '') || attempt === 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

/**
 * Publish a fully built sibling database without exposing a partial seed. The
 * previous database and its SQLite sidecars are moved to a backup first and
 * restored if any publication step fails.
 */
async function publishDatabase(stagingPath: string, targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.backup-${process.pid}`;
  const suffixes = ['', '-wal', '-shm'];
  await Promise.all(suffixes.map((suffix) => removeDatabaseArtifact(backupPath + suffix)));

  const movedOld: string[] = [];
  const movedNew: string[] = [];
  try {
    for (const suffix of suffixes) {
      if (!fs.existsSync(targetPath + suffix)) continue;
      await renameDatabaseArtifact(targetPath + suffix, backupPath + suffix);
      movedOld.push(suffix);
    }
    for (const suffix of suffixes) {
      if (!fs.existsSync(stagingPath + suffix)) continue;
      await renameDatabaseArtifact(stagingPath + suffix, targetPath + suffix);
      movedNew.push(suffix);
    }
    if (!movedNew.includes('')) throw new Error('The staged database file disappeared before publication.');
  } catch (error) {
    for (const suffix of [...movedNew].reverse()) {
      if (fs.existsSync(targetPath + suffix)) {
        await renameDatabaseArtifact(targetPath + suffix, stagingPath + suffix).catch(() => undefined);
      }
    }
    for (const suffix of [...movedOld].reverse()) {
      if (fs.existsSync(backupPath + suffix)) {
        await renameDatabaseArtifact(backupPath + suffix, targetPath + suffix).catch(() => undefined);
      }
    }
    throw error;
  }

  await Promise.all(suffixes.map((suffix) => removeDatabaseArtifact(backupPath + suffix)));
}

async function populateDatabase(db: Client, gaps: Gap[]): Promise<void> {
  await db.executeMultiple(fs.readFileSync(path.resolve('database/schema.sql'), 'utf-8'));
  await db.execute("INSERT INTO app_metadata (key, value) VALUES ('schema_version', '6')");
  await db.execute({
    sql: "INSERT INTO app_metadata (key, value) VALUES ('credential_mode', ?)",
    args: [credentialMode],
  });

  // -- Majors ---------------------------------------------------------------
  for (const m of MAJORS) {
    await db.execute({ sql: 'INSERT INTO majors (name, name_ar) VALUES (?, ?)', args: [m.name, m.name_ar] });
  }

  // -- Courses --------------------------------------------------------------
  const referenced = new Set<string>();
  for (const plans of Object.values(STUDY_PLANS)) {
    for (const codes of Object.values(plans)) codes.forEach((c) => referenced.add(c));
  }
  PREREQUISITES.forEach(({ course, prereq }) => {
    referenced.add(course);
    referenced.add(prereq);
  });
  Object.values(ELECTIVE_POOLS).forEach((codes) => codes.forEach((c) => referenced.add(c)));

  for (const code of [...referenced].sort()) {
    const title = COURSE_TITLES[code];
    if (!title) {
      gaps.push({ kind: 'missing-course-title', detail: `${code} appears in a study plan but has no official title` });
    }
    const meta = COURSE_META[code] ?? {};
    await db.execute({
      sql: 'INSERT INTO courses (code, title, credits, course_type, requirement) VALUES (?, ?, ?, ?, ?)',
      args: [
        code,
        title ?? code,
        3,
        meta.type ?? (ELECTIVE_CODES.has(code) ? 'Elective' : 'Core'),
        meta.req ?? 'Specialization',
      ],
    });
  }

  // -- Elective pools -------------------------------------------------------
  for (const [major, codes] of Object.entries(ELECTIVE_POOLS)) {
    for (const code of [...new Set(codes)]) {
      await db.execute({
        sql: 'INSERT INTO elective_pool (major, course_code) VALUES (?, ?)',
        args: [major, code],
      });
    }
  }

  // -- Study plans ----------------------------------------------------------
  for (const [major, plans] of Object.entries(STUDY_PLANS)) {
    for (const [lvl, codes] of Object.entries(plans)) {
      for (const code of codes as string[]) {
        await db.execute({
          sql: `INSERT INTO study_plan_items (major, level, semester, course_code, is_elective)
                VALUES (?, ?, ?, ?, ?)`,
          args: [major, lvl, plannedSemester(codes as string[], code), code, ELECTIVE_CODES.has(code) ? 1 : 0],
        });
      }
    }
  }

  for (const major of MAJORS.map((m) => m.name)) {
    if (major === 'Common') continue;
    for (const lvl of LEVEL_ORDER) {
      if (lvl === 'Diploma First Year') continue;
      if (!STUDY_PLANS[major]?.[lvl]) {
        gaps.push({ kind: 'missing-study-plan', detail: `${major} has no "${lvl}" plan in the source document` });
      }
    }
  }

  // -- Prerequisites --------------------------------------------------------
  for (const { course, prereq, group } of PREREQUISITES) {
    await db.execute({
      sql: 'INSERT INTO course_prerequisites (course_code, prereq_code, alt_group) VALUES (?, ?, ?)',
      args: [course, prereq, group ?? 0],
    });
  }

  SOURCE_CONFLICTS.forEach((detail) => gaps.push({ kind: 'source-conflict', detail }));

  // -- Staff ----------------------------------------------------------------
  for (const s of STAFF) {
    await db.execute({
      sql: `INSERT INTO users (id, name, email, phone, department, role, password_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [s.id, s.name, s.email, s.phone, s.department, s.role, credentialHash(s.passwordHash)],
    });
  }

  // No demo or generated account is seeded. Only the official PDF accounts
  // above are present, and their passwords enter the database as salted hashes.

  const advisors = new Set(STAFF.filter((s) => s.role === 'Advisor').map((s) => s.id));

  // -- Students -------------------------------------------------------------
  for (const st of STUDENTS) {
    if (!advisors.has(st.advisorId)) {
      gaps.push({ kind: 'unknown-advisor', detail: `${st.id} references missing advisor ${st.advisorId}` });
    }

    await db.execute({
      sql: `INSERT INTO users (id, name, email, phone, department, role, password_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [st.id, st.name, st.email, st.phone, 'Information Technology', 'Student', credentialHash(st.passwordHash)],
    });
    await db.execute({
      sql: 'INSERT INTO students (id, major, level, gpa, advisor_id) VALUES (?, ?, ?, ?, ?)',
      args: [st.id, st.major, st.level, st.gpa, st.advisorId],
    });
  }

  // Seal the authoritative identity set only after every official account is
  // inserted. The schema trigger then rejects any runtime account creation.
  await db.execute("INSERT INTO app_metadata (key, value) VALUES ('identity_sealed', '1')");

  await db.batch(
    [
      { sql: "INSERT INTO university_settings (key, value) VALUES ('portal_notice', '')", args: [] },
      { sql: "INSERT INTO university_settings (key, value) VALUES ('support_email', 'support@utas.edu.om')", args: [] },
      { sql: "INSERT INTO university_settings (key, value) VALUES ('academic_year', '2025/2026')", args: [] },
    ],
    'write',
  );

  // -- Enrollments ----------------------------------------------------------
  for (const st of STUDENTS) {
    const terms = termSequence(st.major, st.level);

    // The student sits in the last term of the sequence; everything before it
    // is history. First-years therefore have one completed semester.
    const currentIdx = terms.length - (st.level === 'Diploma First Year' ? 1 : 2);
    const current = Math.max(0, currentIdx);

    const completedCodes: { code: string; termOffset: number }[] = [];
    const inProgressCodes: string[] = [];

    terms.forEach((t, i) => {
      const codes = coursesFor(st.major, t.level, t.semester);
      if (i < current) {
        codes.forEach((code) => completedCodes.push({ code, termOffset: i - current }));
      } else if (i === current) {
        inProgressCodes.push(...codes);
      }
    });

    const completedCourseTarget = st.completedCredits === undefined
      ? completedCodes.length
      : Math.floor(st.completedCredits / 3);
    if (completedCodes.length > completedCourseTarget) {
      completedCodes.splice(completedCourseTarget);
    }
    const completedSet = new Set(completedCodes.map(({ code }) => code));
    for (let i = current; i < terms.length && completedCodes.length < completedCourseTarget; i++) {
      for (const code of coursesFor(st.major, terms[i].level, terms[i].semester)) {
        if (completedCodes.length >= completedCourseTarget) break;
        if (completedSet.has(code)) continue;
        completedSet.add(code);
        completedCodes.push({ code, termOffset: -1 });
      }
    }

    // GPA targets are deterministic demo data because no official GPA source
    // was supplied. Seeded history represents earned credit, so every generated
    // grade must be passing. Failed attempts remain supported by the runtime model.
    const grades = gradesForTarget(completedCodes.map(() => 3), st.gpa, { minimumPoints: 1 });
    const seen = new Set<string>();

    for (let i = 0; i < completedCodes.length; i++) {
      const { code, termOffset } = completedCodes[i];
      if (seen.has(code)) continue; // a course shared across levels is taken once
      seen.add(code);
      await db.execute({
        sql: `INSERT INTO enrollments (student_id, course_code, term, term_order, status, grade, grade_points)
              VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
        args: [st.id, code, termName(CURRENT_TERM_INDEX + termOffset), termOffset, grades[i].grade, grades[i].points],
      });
    }

    for (const code of inProgressCodes) {
      if (seen.has(code)) continue;
      seen.add(code);
      await db.execute({
        sql: `INSERT INTO enrollments (student_id, course_code, term, term_order, status, grade, grade_points)
              VALUES (?, ?, ?, 0, 'in_progress', NULL, NULL)`,
        args: [st.id, code, termName(CURRENT_TERM_INDEX)],
      });
    }

    // Reconcile: the transcript we generated should reproduce the stated GPA.
    const rs = await db.execute({
      sql: `SELECT SUM(e.grade_points * c.credits) / SUM(c.credits) avg
            FROM enrollments e JOIN courses c ON c.code = e.course_code
            WHERE e.student_id = ? AND e.status = 'completed'`,
      args: [st.id],
    });
    const computed = rs.rows[0]?.avg as number | null;
    if (computed !== null && Math.abs(computed - st.gpa) > 0.05) {
      gaps.push({
        kind: 'gpa-mismatch',
        detail: `${st.id}: stated GPA ${st.gpa}, transcript averages ${computed.toFixed(2)}`,
      });
    }
  }
}

async function build(): Promise<Gap[]> {
  // Validate production credential configuration and the entire dataset before
  // constructing even the isolated staging database.
  assertDatasetIntegrity();
  const parentPid = process.env.SAS_INTERNAL_SEED_PARENT_PID;
  if (!DIRECT_BUILD || !parentPid || !DB_FILE.endsWith(`.building-${parentPid}.sqlite`)) {
    throw new Error('Direct database construction is restricted to the seeder staging process.');
  }
  const gaps: Gap[] = [];

  await fs.promises.mkdir(path.dirname(DB_FILE), { recursive: true });
  await Promise.all(['', '-wal', '-shm'].map((suffix) => removeDatabaseArtifact(DB_FILE + suffix)));

  const db: Client = createClient({ url: localDatabaseUrl(DB_FILE) });
  let databaseClosed = false;
  let completed = false;
  try {
    await populateDatabase(db, gaps);
    db.close();
    databaseClosed = true;
    completed = true;
    return gaps;
  } finally {
    if (!databaseClosed) db.close();
    if (!completed) {
      await Promise.allSettled(['', '-wal', '-shm'].map((suffix) => removeDatabaseArtifact(DB_FILE + suffix)));
    }
  }
}

async function reportBuild(gaps: Gap[]): Promise<void> {
  const db = createClient({ url: localDatabaseUrl(DB_FILE) });
  try {
    const quickCheck = await db.execute('PRAGMA quick_check');
    if (quickCheck.rows.length !== 1 || String(quickCheck.rows[0].quick_check).toLowerCase() !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${JSON.stringify(quickCheck.rows)}`);
    }
    const foreignKeyViolations = await db.execute('PRAGMA foreign_key_check');
    if (foreignKeyViolations.rows.length > 0) {
      throw new Error(`SQLite foreign_key_check found ${foreignKeyViolations.rows.length} violation(s).`);
    }

    const count = async (table: string) => (await db.execute(`SELECT COUNT(*) c FROM ${table}`)).rows[0].c;

    console.log('\nStaged database built and validated.\n');
    for (const table of ['majors', 'users', 'students', 'courses', 'study_plan_items', 'course_prerequisites', 'enrollments']) {
      console.log(`  ${table.padEnd(22)} ${await count(table)}`);
    }

    if (gaps.length) {
      console.log(`\n${gaps.length} gap(s) in the source dataset — these need a decision, nothing was invented:\n`);
      const byKind = new Map<string, string[]>();
      gaps.forEach((gap) => byKind.set(gap.kind, [...(byKind.get(gap.kind) ?? []), gap.detail]));
      for (const [kind, details] of byKind) {
        console.log(`  ${kind} (${details.length})`);
        details.forEach((detail) => console.log(`    - ${detail}`));
      }
    } else {
      console.log('\nNo gaps detected in the source dataset.');
    }
    console.log('');
  } finally {
    db.close();
  }
}

async function orchestrateSeed(): Promise<void> {
  // Both checks happen before any existing database artifact is touched.
  assertDatasetIntegrity();
  await fs.promises.mkdir(path.dirname(DB_FILE), { recursive: true });
  const runtimeLock = await acquireDatabaseRuntimeLock(DB_FILE, 'seeder');
  const stagingPath = `${DB_FILE}.building-${process.pid}.sqlite`;
  try {
    if (
      process.env.NODE_ENV === 'production' &&
      INITIAL_PRODUCTION_SEED &&
      fs.existsSync(DB_FILE)
    ) {
      throw new Error('Refusing to replace a production database that appeared during initial seeding.');
    }
    await Promise.all(['', '-wal', '-shm'].map((suffix) => removeDatabaseArtifact(stagingPath + suffix)));
    try {
      const currentScript = fileURLToPath(import.meta.url);
      const childArgs = currentScript.endsWith('.ts')
        ? ['--import', 'tsx', currentScript]
        : [currentScript];
      const child = spawnSync(
        process.execPath,
        childArgs,
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_PATH: stagingPath,
            SAS_INTERNAL_DIRECT_SEED: '1',
            SAS_INTERNAL_SEED_PARENT_PID: String(process.pid),
          },
          stdio: 'inherit',
          shell: false,
        },
      );
      if (child.error) throw child.error;
      if (child.status !== 0) throw new Error(`Staged database build exited with code ${child.status ?? 'unknown'}.`);

      // The child has exited, guaranteeing all native SQLite handles are closed
      // before Windows is asked to rename the staged database.
      await publishDatabase(stagingPath, DB_FILE);
      console.log('Database published atomically.\n');
    } finally {
      await Promise.allSettled(['', '-wal', '-shm'].map((suffix) => removeDatabaseArtifact(stagingPath + suffix)));
    }
  } finally {
    await runtimeLock.release();
  }
}

const operation = DIRECT_BUILD
  ? build().then(reportBuild)
  : orchestrateSeed();

operation
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  });
