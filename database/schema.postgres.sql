-- PostgreSQL schema for the durable Neon deployment.  This is deliberately
-- separate from schema.sql so local SQLite development remains supported.

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS majors (
  name TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  email TEXT NOT NULL CHECK (length(email) <= 120),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 20),
  department TEXT NOT NULL CHECK (length(department) BETWEEN 2 AND 100),
  role TEXT NOT NULL CHECK (role IN ('System Admin', 'Registrar Admin', 'Student Affairs Admin', 'Advisor', 'Student')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_id_nocase ON users(lower(id));

CREATE OR REPLACE FUNCTION protect_official_user() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.email IS DISTINCT FROM OLD.email OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    RAISE EXCEPTION 'official account identity and credential fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS users_protect_official_identity_before_update ON users;
CREATE TRIGGER users_protect_official_identity_before_update
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_official_user();

CREATE OR REPLACE FUNCTION reject_official_user_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'official accounts cannot be deleted';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS users_protect_official_account_before_delete ON users;
CREATE TRIGGER users_protect_official_account_before_delete
  BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION reject_official_user_delete();

CREATE OR REPLACE FUNCTION reject_sealed_user_insert() RETURNS trigger AS $$
BEGIN
  IF COALESCE((SELECT value FROM app_metadata WHERE key = 'identity_sealed'), '0') = '1' THEN
    RAISE EXCEPTION 'official account set is sealed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS users_reject_insert_when_identity_sealed ON users;
CREATE TRIGGER users_reject_insert_when_identity_sealed
  BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION reject_sealed_user_insert();

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC, token DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS university_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('portal_notice', 'support_email', 'academic_year')),
  value TEXT NOT NULL CHECK (length(value) <= 500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  major TEXT NOT NULL REFERENCES majors(name),
  level TEXT NOT NULL CHECK (level IN ('Diploma First Year', 'Diploma Second Year', 'Advanced Diploma', 'BTech')),
  gpa REAL NOT NULL CHECK (gpa >= 0.0 AND gpa <= 4.0),
  advisor_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_students_advisor ON students(advisor_id);

CREATE OR REPLACE FUNCTION validate_student_roles() RETURNS trigger AS $$
BEGIN
  IF (SELECT role FROM users WHERE id = NEW.id) <> 'Student' THEN
    RAISE EXCEPTION 'student id must reference a Student account';
  END IF;
  IF NEW.advisor_id IS NOT NULL AND COALESCE((SELECT role FROM users WHERE id = NEW.advisor_id), '') <> 'Advisor' THEN
    RAISE EXCEPTION 'advisor_id must reference an Advisor account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS students_validate_roles ON students;
CREATE TRIGGER students_validate_roles BEFORE INSERT OR UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION validate_student_roles();

CREATE TABLE IF NOT EXISTS courses (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 3 CHECK (credits > 0),
  course_type TEXT NOT NULL DEFAULT 'Core' CHECK (course_type IN ('Core', 'Elective')),
  requirement TEXT CHECK (requirement IN ('University', 'College', 'Specialization'))
);

CREATE TABLE IF NOT EXISTS study_plan_items (
  major TEXT NOT NULL REFERENCES majors(name) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('Diploma First Year', 'Diploma Second Year', 'Advanced Diploma', 'BTech')),
  semester INTEGER NOT NULL CHECK (semester IN (1, 2)),
  course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  is_elective INTEGER NOT NULL DEFAULT 0 CHECK (is_elective IN (0, 1)),
  PRIMARY KEY (major, level, course_code)
);
CREATE INDEX IF NOT EXISTS idx_plan_major_level ON study_plan_items(major, level, semester);

CREATE TABLE IF NOT EXISTS course_prerequisites (
  course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  prereq_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  alt_group INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (course_code, prereq_code),
  CHECK (course_code <> prereq_code)
);

CREATE TABLE IF NOT EXISTS elective_pool (
  major TEXT NOT NULL REFERENCES majors(name) ON DELETE CASCADE,
  course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  PRIMARY KEY (major, course_code)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  term TEXT NOT NULL,
  term_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'in_progress', 'planned')),
  grade TEXT,
  grade_points REAL CHECK (grade_points IS NULL OR (grade_points >= 0.0 AND grade_points <= 4.0)),
  CHECK ((status = 'completed' AND ((grade = 'A' AND grade_points = 4.0) OR (grade = 'A-' AND grade_points = 3.7) OR (grade = 'B+' AND grade_points = 3.3) OR (grade = 'B' AND grade_points = 3.0) OR (grade = 'B-' AND grade_points = 2.7) OR (grade = 'C+' AND grade_points = 2.3) OR (grade = 'C' AND grade_points = 2.0) OR (grade = 'C-' AND grade_points = 1.7) OR (grade = 'D+' AND grade_points = 1.3) OR (grade = 'D' AND grade_points = 1.0) OR (grade = 'F' AND grade_points = 0.0))) OR (status <> 'completed' AND grade IS NULL AND grade_points IS NULL)),
  UNIQUE (student_id, course_code)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id, term_order);

CREATE OR REPLACE FUNCTION sync_student_gpa() RETURNS trigger AS $$
DECLARE affected_student TEXT;
BEGIN
  affected_student := COALESCE(NEW.student_id, OLD.student_id);
  UPDATE students SET gpa = COALESCE((SELECT ROUND((SUM(e.grade_points * c.credits) / SUM(c.credits))::numeric, 2)
    FROM enrollments e JOIN courses c ON c.code = e.course_code WHERE e.student_id = affected_student AND e.status = 'completed'), 0)
    WHERE id = affected_student;
  IF TG_OP = 'UPDATE' AND NEW.student_id <> OLD.student_id THEN
    UPDATE students SET gpa = COALESCE((SELECT ROUND((SUM(e.grade_points * c.credits) / SUM(c.credits))::numeric, 2)
      FROM enrollments e JOIN courses c ON c.code = e.course_code WHERE e.student_id = OLD.student_id AND e.status = 'completed'), 0)
      WHERE id = OLD.student_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS enrollments_sync_gpa ON enrollments;
CREATE TRIGGER enrollments_sync_gpa AFTER INSERT OR UPDATE OR DELETE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION sync_student_gpa();

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  CHECK (sender_id <> receiver_id), CHECK (length(content) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread_sender ON messages(receiver_id, is_read, sender_id);

CREATE TABLE IF NOT EXISTS advisor_notes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  advisor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(content) BETWEEN 1 AND 4000)
);
CREATE OR REPLACE FUNCTION validate_note_advisor() RETURNS trigger AS $$
BEGIN
  IF COALESCE((SELECT role FROM users WHERE id = NEW.advisor_id), '') <> 'Advisor' THEN
    RAISE EXCEPTION 'advisor_id must reference an Advisor account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS notes_validate_advisor_before_insert ON advisor_notes;
CREATE TRIGGER notes_validate_advisor_before_insert BEFORE INSERT ON advisor_notes
  FOR EACH ROW EXECUTE FUNCTION validate_note_advisor();
CREATE INDEX IF NOT EXISTS idx_notes_student_advisor ON advisor_notes(student_id, advisor_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(content) BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS idx_chat_user_recent ON chat_messages(user_id, id DESC);
