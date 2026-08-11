/**
 * Password and credential hashing.
 *
 * Uses Node's built-in scrypt, so there is no native dependency to compile and
 * nothing extra to install. Each hash carries its own random salt and the
 * parameters used to produce it, so the cost can be raised later without
 * invalidating existing hashes.
 */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// eslint-disable-next-line no-control-regex -- passwords containing C0 controls are intentionally rejected.
const PASSWORD_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/** Hash a secret. Returns `scrypt$<salt-hex>$<key-hex>`. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(secret.normalize('NFKC'), salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify a secret against a stored hash. Always performs the full derivation
 * and a constant-time compare so that a missing or malformed hash does not
 * return measurably faster than a wrong password.
 */
export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid =
    parts.length === 3 &&
    parts[0] === 'scrypt' &&
    new RegExp(`^[0-9a-f]{${SALT_LENGTH * 2}}$`, 'i').test(parts[1]) &&
    new RegExp(`^[0-9a-f]{${KEY_LENGTH * 2}}$`, 'i').test(parts[2]);

  // Fall back to a dummy salt/key so the work done is the same either way.
  const saltHex = valid ? parts[1] : '00'.repeat(SALT_LENGTH);
  const keyHex = valid ? parts[2] : '00'.repeat(KEY_LENGTH);

  const expected = Buffer.from(keyHex, 'hex');

  const derived = await scrypt(secret.normalize('NFKC'), Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return valid && timingSafeEqual(derived, expected);
}

/** A cryptographically random session token. */
export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** Store only a one-way digest of bearer session tokens. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Returns null when the password is acceptable, otherwise a stable `code` plus
 * an English fallback `message`. The client translates the code, so these
 * strings are never what an Arabic user sees.
 */
export function validatePasswordStrength(
  password: string,
): { code: string; message: string } | null {
  if (typeof password !== 'string' || password.length < 12) {
    return { code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 12 characters long.' };
  }
  if (password.length > 200) {
    return { code: 'PASSWORD_TOO_LONG', message: 'Password must be at most 200 characters long.' };
  }
  if (
    !/\p{L}/u.test(password) ||
    !/\p{N}/u.test(password) ||
    !/[^\p{L}\p{N}\s]/u.test(password) ||
    PASSWORD_CONTROL_CHARACTERS.test(password)
  ) {
    return {
      code: 'PASSWORD_COMPLEXITY',
      message: 'Password must contain a letter, a digit, and a non-whitespace symbol.',
    };
  }
  return null;
}
