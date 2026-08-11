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
 */

import type { NextFunction, Request, Response } from 'express';
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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/**
 * Read a cookie without pulling in cookie-parser. Values are opaque hex
 * tokens, so no decoding beyond splitting is required.
 */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      return SESSION_TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // keeps the token out of reach of page scripts / XSS
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    priority: 'high',
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
    path: '/',
  });
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

async function resolveSession(db: Client, token: string): Promise<SessionUser | null> {
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

/** Attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(db: Client) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) {
      try {
        req.user = (await resolveSession(db, token)) ?? undefined;
      } catch (error) {
        return next(error);
      }
    }
    next();
  };
}

/**
 * Rejects the request unless a session is present (and, optionally, a role).
 *
 * A valid session is accepted immediately; there is no client-controlled
 * password-change flag that can interfere with authorization.
 */
export function requireAuth(...roles: SessionUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}

/**
 * Staff = anyone who may see beyond their own record.
 *
 * Note this is NOT the same as "may see everything": an Advisor passing this
 * guard still only reaches the students assigned to them. The per-route scoping
 * below is what enforces that, not this guard.
 */
export const requireAdmins = requireAuth(...ADMIN_ROLES);
export const requireStaff = requireAuth(...ADMIN_ROLES, 'Advisor');
export const requireSystemAdmin = requireAuth('System Admin');
export const requireRegistrar = requireAuth('System Admin', 'Registrar Admin');
export const requireStudentAffairs = requireAuth('System Admin', 'Student Affairs Admin');
export const requireStudentManagement = requireAuth(
  'System Admin',
  'Registrar Admin',
  'Student Affairs Admin',
  'Advisor',
);

/**
 * A student may address only their own record; an advisor only assigned
 * students; an administrator any student record.
 * Used to close the old /api/student/:id and /api/messages/:userId holes.
 */
export async function canAccessStudent(db: SqlExecutor, req: Request, studentId: string): Promise<boolean> {
  if (!req.user) return false;
  if (isAdministrativeRole(req.user.role)) return true;
  if (req.user.role === 'Student') return req.user.id === studentId;
  const rs = await db.execute({
    sql: 'SELECT 1 FROM students WHERE id = ? AND advisor_id = ?',
    args: [studentId, req.user.id],
  });
  return rs.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * Login.
 *
 * The identifier field accepts EITHER the student/staff ID OR the email
 * address — a single input, matched against both columns.
 *
 * Passwords are scrypt-hashed. Civil/national IDs are not authentication
 * credentials and are not present in the database.
 *
 * Error responses carry a stable `code` so the client can localise the message.
 * They previously returned English prose only, which is why Arabic users saw
 * English login errors.
 */
export function loginHandler(db: Client) {
  return async (req: Request, res: Response) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.normalize('NFKC').trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || identifier.length > 120 || !password || password.length > 200) {
      return res
        .status(400)
        .json({ error: 'Identifier and password are required.', code: 'MISSING_FIELDS' });
    }

    const rs = await db.execute({
      sql: `SELECT id, name, email, phone, department, role, password_hash
            FROM users WHERE id = ? COLLATE NOCASE
            UNION ALL
            SELECT id, name, email, phone, department, role, password_hash
            FROM users WHERE email = ? COLLATE NOCASE
            LIMIT 1`,
      args: [identifier, identifier],
    });

    const userRow = rs.rows[0];

    // Verify against a dummy hash when the user is unknown so that a bad
    // username costs the same time as a bad password (no user enumeration).
    const ok = await verifySecret(password, userRow?.password_hash as string | undefined);

    if (!userRow || !ok) {
      return res.status(401).json({ error: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' });
    }

    const user = sessionUserFromRow(userRow);

    const token = await createSession(db, user.id);
    setSessionCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        department: user.department,
        role: user.role,
      },
    });
  };
}

export function logoutHandler(db: Client) {
  return async (req: Request, res: Response) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) {
      await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [hashSessionToken(token)] });
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ success: true });
  };
}

/** Lets the SPA restore state on reload without trusting localStorage. */
export function meHandler() {
  return (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });
    }
    return res.json({ user: req.user });
  };
}

/** Housekeeping so the sessions table does not grow without bound. */
export async function purgeExpiredSessions(db: Client) {
  await db.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')");
}
