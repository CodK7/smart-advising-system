/**
 * Promise-based PostgreSQL adapter.  It intentionally has the same small
 * surface as the SQLite adapter, so application code remains database-agnostic.
 *
 * Compatible with both Node.js and Cloudflare Workers:
 * - In Node.js, pass a standard postgres:// connection string.
 * - In Cloudflare Workers, pass env.HYPERDRIVE.connectionString from a
 *   Hyperdrive binding. The `pg` library uses `net.Socket` which Cloudflare's
 *   Workers runtime polyfills via `nodejs_compat_v2`; Hyperdrive intercepts
 *   those connections and provides a managed pool against the origin database.
 */
import { Pool, type PoolClient } from 'pg';
import type { Client, InArgs, InStatement, ResultSet, Row, Transaction } from './sqlite.js';

function normalize(statement: InStatement): { sql: string; args: InArgs } {
  return typeof statement === 'string'
    ? { sql: statement, args: [] }
    : { sql: statement.sql, args: statement.args ?? [] };
}

/** Convert the project's established SQLite-style placeholders to PostgreSQL. */
function postgresSql(sql: string): string {
  let parameter = 0;
  let quoted = false;
  let output = '';
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      output += character;
      if (quoted && sql[index + 1] === "'") {
        output += sql[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    output += !quoted && character === '?' ? `$${++parameter}` : character;
  }
  return output
    .replace(/datetime\('now'\s*,\s*'\+([0-9]+) hours'\)/gi, "CURRENT_TIMESTAMP + INTERVAL '$1 hours'")
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/([a-z_][a-z0-9_.]*)\s*=\s*(\$[0-9]+)\s+COLLATE\s+NOCASE/gi, 'LOWER($1) = LOWER($2)')
    .replace(/GROUP_CONCAT\(DISTINCT\s+([^)]+)\)/gi, "STRING_AGG(DISTINCT $1, ',')")
    .replace(/\bLIMIT\s+-1\b/gi, 'LIMIT ALL');
}

async function execute(client: Pool | PoolClient, statement: InStatement): Promise<ResultSet> {
  const { sql, args } = normalize(statement);
  const result = await client.query(postgresSql(sql), [...args]);
  const rows = Array.isArray(result) ? [] : result.rows as Row[];
  const firstId = rows[0]?.id;
  const lastInsertRowid = typeof firstId === 'number' || typeof firstId === 'bigint'
    ? firstId
    : typeof firstId === 'string' && /^\d+$/.test(firstId) ? Number(firstId) : 0;
  return {
    rows,
    rowsAffected: Array.isArray(result) ? 0 : (result.rowCount ?? 0),
    lastInsertRowid,
  };
}

class PostgresTransaction implements Transaction {
  private finished = false;

  constructor(private readonly client: PoolClient) {}

  async execute(statement: InStatement): Promise<ResultSet> {
    if (this.finished) throw new Error('Transaction is already closed.');
    return execute(this.client, statement);
  }

  async batch(statements: readonly InStatement[]): Promise<ResultSet[]> {
    if (this.finished) throw new Error('Transaction is already closed.');
    const results: ResultSet[] = [];
    for (const statement of statements) results.push(await execute(this.client, statement));
    return results;
  }

  async commit(): Promise<void> {
    if (this.finished) return;
    try {
      await this.client.query('COMMIT');
    } finally {
      this.finished = true;
      this.client.release();
    }
  }

  async rollback(): Promise<void> {
    if (this.finished) return;
    try {
      await this.client.query('ROLLBACK');
    } finally {
      this.finished = true;
      this.client.release();
    }
  }

  close(): void {
    if (!this.finished) {
      this.finished = true;
      void this.client.query('ROLLBACK').catch(() => undefined).finally(() => this.client.release());
    }
  }
}

class PostgresClient implements Client {
  readonly dialect = 'postgres' as const;
  private closed = false;

  constructor(private readonly pool: Pool) {}

  private ensureOpen(): void {
    if (this.closed) throw new Error('Database client is closed.');
  }

  async execute(statement: InStatement): Promise<ResultSet> {
    this.ensureOpen();
    return execute(this.pool, statement);
  }

  async executeMultiple(sql: string): Promise<void> {
    this.ensureOpen();
    await this.pool.query(sql);
  }

  async batch(statements: readonly InStatement[], mode: 'read' | 'write' = 'write'): Promise<ResultSet[]> {
    const transaction = await this.transaction(mode);
    try {
      const results = await transaction.batch(statements);
      await transaction.commit();
      return results;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }
  }

  async transaction(_mode: 'read' | 'write' = 'write'): Promise<Transaction> {
    this.ensureOpen();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      return new PostgresTransaction(client);
    } catch (error) {
      client.release();
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.pool.end();
  }
}

export function createPostgresClient(connectionString: string): Client {
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error('Connection string must be a PostgreSQL URL.');
  }
  // Hyperdrive (in Workers) already pools connections, so we keep a small
  // per-isolate pool. In Node.js (dev) this is the only pool.
  return new PostgresClient(new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  }));
}
