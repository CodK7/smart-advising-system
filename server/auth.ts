/**
 * Authentication and authorization.
 *
 * The previous implementation had no concept of a session: the client held the
 * user object in localStorage and every API route trusted whatever it was
 * given. Role was read from the request body, so a student could call the
 * admin endpoints, read anyone's messages, and send messages as anyone.
 *
 * Here the server issues an opaque session token in an httpOnly cookie, and
 * every protected route resolves the caller from that token alone.
 *
 * The module is intentionally framework-agnostic: it exposes pure functions
 * for cookie parsing, session resolution, and login/logout, which the Hono
 * router in server.ts wires into HTTP routes.
 */

import type { Client, InStatement, ResultSet, Row, Transaction } from '../database/sqlite.js';
import {
  hashSessionToken,
  newSessionToken,
  verifySecret,
} from './crypto.js';

const COOKIE_NAME = 'sas_session';
const SESSION_TTL_HOURS = 8;
const MAX_ACTIVE_SESSIONS = 10;
const SESSION_TOKEN = /^[0-9a-f]{64}$/;

type SessionStore = Pick<Client, 'execute'> | Pick<Transaction, 'execute'>;
export interface SqlExecutor {
  execute(statement: InStatement): Promise<ResultSet>;
}

export type ApplicationRole =
  | 'System Admin'
  | 'Registrar Admin'
  | 'Student Affairs Admin'
  | 'Advisor'
  | 'Student';

export const ADMIN_ROLES: readonly ApplicationRole[] = [
  'System Admin',
  'Registrar Admin',
  'Student Affairs Admin',
];

export function isAdministrativeRole(role: string): role is Extract<ApplicationRole, `${string} Admin`> {
  return ADMIN_ROLES.includes(role as ApplicationRole);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string;
  role: ApplicationRole;
}

/**
 * Read a cookie without pulling in cookie-parser. Values are opaque hex
 * tokens, so no decoding beyond splitting is required.
 */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) {
      const value = part.slice(idx + 1).trim();
      return SESSION_TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

export interface SessionCookieOptions {
  isProduction: boolean;
}

/** Build the Set-Cookie header value for a session token. */
export function buildSessionCookieHeader(token: string, options: SessionCookieOptions): string {
  const maxAge = SESSION_TTL_HOURS * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Priority=High',
    `Max-Age=${maxAge}`,
  ];
  if (options.isProduction) parts.push('Secure');
  return parts.join('; ');
}

/** Build the Set-Cookie header that clears the session cookie. */
export function buildClearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function createSession(db: Client, userId: string): Promise<string> {
  const token = newSessionToken();
  const transaction = await db.transaction('write');
  try {
    await transaction.execute({
      sql: "DELETE FROM sessions WHERE user_id = ? AND expires_at <= datetime('now')",
      args: [userId],
    });
    await transaction.execute({
      sql: `DELETE FROM sessions
            WHERE user_id = ? AND token IN (
              SELECT token FROM sessions WHERE user_id = ?
              ORDER BY created_at DESC, token DESC LIMIT -1 OFFSET ?
            )`,
      args: [userId, userId, MAX_ACTIVE_SESSIONS - 1],
    });
    await insertSession(transaction, token, userId);
    await transaction.commit();
  } finally {
    transaction.close();
  }
  return token;
}

async function insertSession(db: SessionStore, token: string, userId: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO sessions (token, user_id, expires_at)
          VALUES (?, ?, datetime('now', '+${SESSION_TTL_HOURS} hours'))`,
    args: [hashSessionToken(token), userId],
  });
}

export async function resolveSession(db: Client, token: string): Promise<SessionUser | null> {
  const rs = await db.execute({
    sql: `SELECT u.id, u.name, u.email, u.phone, u.department, u.role
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > datetime('now')`,
    args: [hashSessionToken(token)],
  });
  if (rs.rows.length === 0) return null;
  return sessionUserFromRow(rs.rows[0]);
}

function sessionUserFromRow(row: Row): SessionUser {
  const role = String(row.role);
  if (!['Student', 'Advisor', ...ADMIN_ROLES].includes(role as ApplicationRole)) {
    throw new Error('Account has an invalid role.');
  }
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    phone: row.phone === null ? null : String(row.phone),
    department: String(row.department),
    role: role as ApplicationRole,
  };
}

/**
 * A student may address only their own record; an advisor only assigned
 * students; an administrator any student record.
 * Used to close the old /api/student/:id and /api/messages/:userId holes.
 */
export async function canAccessStudent(
  db: SqlExecutor,
  user: SessionUser | undefined,
  studentId: string,
): Promise<boolean> {
  if (!user) return false;
  if (isAdministrativeRole(user.role)) return true;
  if (user.role === 'Student') return user.id === studentId;
  const rs = await db.execute({
    sql: 'SELECT 1 FROM students WHERE id = ? AND advisor_id = ?',
    args: [studentId, user.id],
  });
  return rs.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Login / logout logic (framework-agnostic)
// ---------------------------------------------------------------------------

/**
 * Login. The identifier field accepts EITHER the student/staff ID OR the
 * email address — a single input, matched against both columns.
 *
 * Passwords are scrypt-hashed. Civil/national IDs are not authentication
 * credentials and are not present in the database.
 */
export async function performLogin(
  db: Client,
  identifier: string,
  password: string,
): Promise<{ user: SessionUser; token: string } | { error: 'MISSING_FIELDS' } | { error: 'INVALID_CREDENTIALS' }> {
  const normalizedIdentifier = identifier.normalize('NFKC').trim();

  if (!normalizedIdentifier || normalizedIdentifier.length > 120 || !password || password.length > 200) {
    return { error: 'MISSING_FIELDS' };
  }

  const rs = await db.execute({
    sql: `SELECT id, name, email, phone, department, role, password_hash
          FROM users WHERE id = ? COLLATE NOCASE
          UNION ALL
          SELECT id, name, email, phone, department, role, password_hash
          FROM users WHERE email = ? COLLATE NOCASE
          LIMIT 1`,
    args: [normalizedIdentifier, normalizedIdentifier],
  });

  const userRow = rs.rows[0];

  // Verify against a dummy hash when the user is unknown so that a bad
  // username costs the same time as a bad password (no user enumeration).
  const ok = await verifySecret(password, userRow?.password_hash as string | undefined);

  if (!userRow || !ok) {
    return { error: 'INVALID_CREDENTIALS' };
  }

  const user = sessionUserFromRow(userRow);
  const token = await createSession(db, user.id);

  return { user, token };
}

/** Housekeeping so the sessions table does not grow without bound. */
export async function purgeExpiredSessions(db: Client) {
  await db.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')");
}

/** Delete a specific session by its token hash. */
export async function deleteSession(db: Client, token: string) {
  await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [hashSessionToken(token)] });
}
