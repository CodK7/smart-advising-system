import type { Client } from './sqlite.js';
import { STAFF, STUDENTS } from './dataset.js';

/**
 * Fail closed when the runtime database drifts from the official login-data
 * account set. Identity is checked in every environment. Production also
 * verifies the exact precomputed credential hashes so the PDF credentials
 * cannot silently drift.
 */
export async function assertOfficialAccountState(
  db: Pick<Client, 'execute'>,
  options: { checkCredentialHashes?: boolean } = {},
): Promise<void> {
  const expected = [...STAFF, ...STUDENTS];
  const expectedById = new Map(expected.map((person) => [person.id, person]));
  const seal = await db.execute(
    "SELECT value FROM app_metadata WHERE key = 'identity_sealed'",
  );
  if (String(seal.rows[0]?.value ?? '') !== '1') {
    throw new Error('official account set is not sealed');
  }
  const result = await db.execute(
    'SELECT id, name, email, role, password_hash FROM users ORDER BY id',
  );
  if (result.rows.length !== expected.length) {
    throw new Error(`official account count mismatch: expected ${expected.length}, found ${result.rows.length}`);
  }

  for (const row of result.rows) {
    const id = String(row.id);
    const person = expectedById.get(id);
    if (!person) throw new Error(`unexpected account in database: ${id}`);
    const expectedRole = 'role' in person ? person.role : 'Student';
    if (
      String(row.name) !== person.name ||
      String(row.email).toLowerCase() !== person.email.toLowerCase() ||
      String(row.role) !== expectedRole
    ) {
      throw new Error(`official identity mismatch for ${id}`);
    }
    if (options.checkCredentialHashes && String(row.password_hash) !== person.passwordHash) {
      throw new Error(`official credential mismatch for ${id}`);
    }
  }
}
