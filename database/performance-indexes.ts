/** Safe, idempotent indexes for databases created before the performance pass. */

import type { Client } from './sqlite.js';

const PERFORMANCE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_users_id_nocase ON users(id COLLATE NOCASE)',
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_created
     ON sessions(user_id, created_at DESC, token DESC)`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
  `CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread_sender
     ON messages(receiver_id, is_read, sender_id)`,
  'CREATE INDEX IF NOT EXISTS idx_chat_user_recent ON chat_messages(user_id, id DESC)',
  'DROP INDEX IF EXISTS idx_sessions_user',
  'DROP INDEX IF EXISTS idx_messages_receiver_unread',
  'DROP INDEX IF EXISTS idx_chat_user',
];

/** Adds only missing indexes; it never changes user, academic, or session data. */
export async function ensurePerformanceIndexes(db: Client): Promise<void> {
  for (const sql of PERFORMANCE_INDEXES) await db.execute(sql);
}
