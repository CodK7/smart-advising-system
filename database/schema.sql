-- Smart Academic Advising System — relational schema
-- UTAS Nizwa. Rebuilt to add referential integrity, academic level tracking,
-- prerequisites, enrollment history, and hashed credentials.
--
-- Rebuild the database from scratch with:  npm run db:reset

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- Majors are a lookup table so student and curriculum records cannot drift
-- apart or hold typos. 'Common' covers the shared General First Year.
CREATE TABLE IF NOT EXISTS majors (
    name    TEXT PRIMARY KEY,
    name_ar TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- Authentication uses a real password hash. National/civil IDs are not stored
-- anywhere in the application database or source dataset.
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
    email         TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(email) <= 120),
    phone         TEXT CHECK (phone IS NULL OR length(phone) <= 20),
    department    TEXT NOT NULL CHECK (length(department) BETWEEN 2 AND 100),
    -- Five official application roles. Administrative roles are deliberately
    -- distinct so backend authorization can enforce least privilege.
    role          TEXT NOT NULL CHECK (role IN (
                    'System Admin',
                    'Registrar Admin',
                    'Student Affairs Admin',
                    'Advisor',
                    'Student')),
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_id_nocase ON users(id COLLATE NOCASE);

-- Official identities come from the login-data PDF and are immutable at runtime.
-- Academic fields live in their own tables and remain editable according to role.
CREATE TRIGGER IF NOT EXISTS users_protect_official_identity_before_update
BEFORE UPDATE OF id, name, email, role, password_hash ON users
BEGIN
  SELECT RAISE(ABORT, 'official account identity and credential fields are immutable');
END;

-- The application contains exactly the official account set. Removing an
-- account would make the database diverge from the source of truth.
CREATE TRIGGER IF NOT EXISTS users_protect_official_account_before_delete
BEFORE DELETE ON users
BEGIN
  SELECT RAISE(ABORT, 'official accounts cannot be deleted');
END;

-- Seeding sets identity_sealed only after all 16 authoritative accounts exist.
-- Once sealed, runtime code cannot append shadow/demo accounts.
CREATE TRIGGER IF NOT EXISTS users_reject_insert_when_identity_sealed
BEFORE INSERT ON users
WHEN COALESCE((SELECT value FROM app_metadata WHERE key = 'identity_sealed'), '0') = '1'
BEGIN
  SELECT RAISE(ABORT, 'official account set is sealed');
END;

-- Server-side sessions. The raw token is delivered as an httpOnly cookie; only
-- its SHA-256 digest is retained, so a database snapshot cannot replay it.
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_created
    ON sessions(user_id, created_at DESC, token DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- University-wide portal settings. Only administrators may mutate these rows.
CREATE TABLE IF NOT EXISTS university_settings (
    key        TEXT PRIMARY KEY CHECK (key IN ('portal_notice', 'support_email', 'academic_year')),
    value      TEXT NOT NULL CHECK (length(value) <= 500),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Academic records
-- ---------------------------------------------------------------------------

-- advisor_id is a real foreign key. The previous schema joined advisors by
-- name, which was ambiguous because several staff share a name.
CREATE TABLE IF NOT EXISTS students (
    id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    major      TEXT NOT NULL REFERENCES majors(name),
    level      TEXT NOT NULL CHECK (level IN (
                   'Diploma First Year',
                   'Diploma Second Year',
                   'Advanced Diploma',
                   'BTech')),
    gpa        REAL NOT NULL CHECK (gpa >= 0.0 AND gpa <= 4.0),
    advisor_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_students_advisor ON students(advisor_id);

CREATE TRIGGER IF NOT EXISTS students_validate_roles_before_insert
BEFORE INSERT ON students
BEGIN
  SELECT CASE WHEN (SELECT role FROM users WHERE id = NEW.id) <> 'Student'
    THEN RAISE(ABORT, 'student id must reference a Student account') END;
  SELECT CASE WHEN NEW.advisor_id IS NOT NULL
                   AND COALESCE((SELECT role FROM users WHERE id = NEW.advisor_id), '') <> 'Advisor'
    THEN RAISE(ABORT, 'advisor_id must reference an Advisor account') END;
END;

CREATE TRIGGER IF NOT EXISTS students_validate_advisor_before_update
BEFORE UPDATE OF advisor_id ON students
WHEN NEW.advisor_id IS NOT NULL
     AND COALESCE((SELECT role FROM users WHERE id = NEW.advisor_id), '') <> 'Advisor'
BEGIN
  SELECT RAISE(ABORT, 'advisor_id must reference an Advisor account');
END;

-- The course catalogue is major-independent. A course such as STAT3101 or
-- UNAB4105 appears in several majors' study plans, which the previous
-- single `major` column could not express: only one major could ever own a
-- shared course, so every other major silently lost it.
CREATE TABLE IF NOT EXISTS courses (
    code        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    credits     INTEGER NOT NULL DEFAULT 3 CHECK (credits > 0),
    -- Core courses are compulsory; Elective courses fill a "Major Elective"
    -- slot in the plan.
    course_type TEXT NOT NULL DEFAULT 'Core' CHECK (course_type IN ('Core', 'Elective')),
    -- Whether the course satisfies a University, College or Specialization
    -- requirement, per the course handbook.
    requirement TEXT CHECK (requirement IN ('University', 'College', 'Specialization'))
);

-- Which courses a given major studies, at which level and in which semester.
CREATE TABLE IF NOT EXISTS study_plan_items (
    major       TEXT NOT NULL REFERENCES majors(name) ON DELETE CASCADE,
    level       TEXT NOT NULL CHECK (level IN (
                    'Diploma First Year',
                    'Diploma Second Year',
                    'Advanced Diploma',
                    'BTech')),
    semester    INTEGER NOT NULL CHECK (semester IN (1, 2)),
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    is_elective INTEGER NOT NULL DEFAULT 0 CHECK (is_elective IN (0, 1)),
    PRIMARY KEY (major, level, course_code)
);

CREATE INDEX IF NOT EXISTS idx_plan_major_level ON study_plan_items(major, level, semester);

-- Drives the "can this student take X next semester?" check.
--
-- The handbook expresses prerequisites as boolean formulas, e.g. CSSE2205
-- requires "CSSE2101 + { CSWD2101 OR CSPG1205 }". alt_group encodes that:
-- rows sharing an alt_group are alternatives (OR); every distinct alt_group
-- must be satisfied (AND). The example becomes
--   (CSSE2205, CSSE2101, group 0)
--   (CSSE2205, CSWD2101, group 1)
--   (CSSE2205, CSPG1205, group 1)
CREATE TABLE IF NOT EXISTS course_prerequisites (
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    prereq_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    alt_group   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (course_code, prereq_code),
    CHECK (course_code <> prereq_code)
);

-- Courses a student may choose from to fill a "Major Elective" slot. Each
-- specialization publishes its own pool.
CREATE TABLE IF NOT EXISTS elective_pool (
    major       TEXT NOT NULL REFERENCES majors(name) ON DELETE CASCADE,
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    PRIMARY KEY (major, course_code)
);

-- The academic transcript. GPA is derived from these rows rather than being a
-- free-floating number, so the dashboard can no longer invent history.
CREATE TABLE IF NOT EXISTS enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_code  TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    term         TEXT NOT NULL,
    term_order   INTEGER NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('completed', 'in_progress', 'planned')),
    grade        TEXT,
    grade_points REAL CHECK (grade_points IS NULL OR (grade_points >= 0.0 AND grade_points <= 4.0)),
    CHECK (
      (status = 'completed' AND (
        (grade = 'A'  AND grade_points = 4.0) OR
        (grade = 'A-' AND grade_points = 3.7) OR
        (grade = 'B+' AND grade_points = 3.3) OR
        (grade = 'B'  AND grade_points = 3.0) OR
        (grade = 'B-' AND grade_points = 2.7) OR
        (grade = 'C+' AND grade_points = 2.3) OR
        (grade = 'C'  AND grade_points = 2.0) OR
        (grade = 'C-' AND grade_points = 1.7) OR
        (grade = 'D+' AND grade_points = 1.3) OR
        (grade = 'D'  AND grade_points = 1.0) OR
        (grade = 'F'  AND grade_points = 0.0)
      ))
      OR
      (status <> 'completed' AND grade IS NULL AND grade_points IS NULL)
    ),
    UNIQUE (student_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id, term_order);

-- students.gpa is a query cache maintained from the transcript, never an
-- independent source of truth. These triggers keep every read path consistent.
CREATE TRIGGER IF NOT EXISTS enrollments_sync_gpa_after_insert
AFTER INSERT ON enrollments
BEGIN
  UPDATE students
  SET gpa = COALESCE((
    SELECT ROUND(SUM(e.grade_points * c.credits) / SUM(c.credits), 2)
    FROM enrollments e JOIN courses c ON c.code = e.course_code
    WHERE e.student_id = NEW.student_id AND e.status = 'completed'
  ), 0)
  WHERE id = NEW.student_id;
END;

CREATE TRIGGER IF NOT EXISTS enrollments_sync_gpa_after_update
AFTER UPDATE ON enrollments
BEGIN
  UPDATE students
  SET gpa = COALESCE((
    SELECT ROUND(SUM(e.grade_points * c.credits) / SUM(c.credits), 2)
    FROM enrollments e JOIN courses c ON c.code = e.course_code
    WHERE e.student_id = OLD.student_id AND e.status = 'completed'
  ), 0)
  WHERE id = OLD.student_id;

  UPDATE students
  SET gpa = COALESCE((
    SELECT ROUND(SUM(e.grade_points * c.credits) / SUM(c.credits), 2)
    FROM enrollments e JOIN courses c ON c.code = e.course_code
    WHERE e.student_id = NEW.student_id AND e.status = 'completed'
  ), 0)
  WHERE id = NEW.student_id AND NEW.student_id <> OLD.student_id;
END;

CREATE TRIGGER IF NOT EXISTS enrollments_sync_gpa_after_delete
AFTER DELETE ON enrollments
BEGIN
  UPDATE students
  SET gpa = COALESCE((
    SELECT ROUND(SUM(e.grade_points * c.credits) / SUM(c.credits), 2)
    FROM enrollments e JOIN courses c ON c.code = e.course_code
    WHERE e.student_id = OLD.student_id AND e.status = 'completed'
  ), 0)
  WHERE id = OLD.student_id;
END;

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    is_read     INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    CHECK (sender_id <> receiver_id),
    CHECK (length(content) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread_sender
    ON messages(receiver_id, is_read, sender_id);

-- ---------------------------------------------------------------------------
-- Advising notes
-- ---------------------------------------------------------------------------

-- Counselling notes an advisor records against a student.
--
-- Scoped by (student_id, advisor_id) rather than student_id alone: a note is
-- one advisor's private record of a conversation, not a shared field on the
-- student. Re-assigning a student therefore does not hand their previous
-- advisor's notes to the new one.
CREATE TABLE IF NOT EXISTS advisor_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    advisor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (length(content) BETWEEN 1 AND 4000)
);

CREATE TRIGGER IF NOT EXISTS notes_validate_advisor_before_insert
BEFORE INSERT ON advisor_notes
WHEN COALESCE((SELECT role FROM users WHERE id = NEW.advisor_id), '') <> 'Advisor'
BEGIN
  SELECT RAISE(ABORT, 'advisor_id must reference an Advisor account');
END;

CREATE INDEX IF NOT EXISTS idx_notes_student_advisor
    ON advisor_notes(student_id, advisor_id);

-- ---------------------------------------------------------------------------
-- AI Chat History
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (length(content) BETWEEN 1 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_chat_user_recent ON chat_messages(user_id, id DESC);
