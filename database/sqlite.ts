/**
 * Small Promise-based adapter over Node's built-in SQLite driver.
 *
 * The application only uses local SQLite files, so a remote libSQL client and
 * platform-specific native package are unnecessary. This adapter preserves the
 * subset of the old client API used by the project while keeping installation
 * platform-neutral on Node 22.12+.
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type InValue = string | number | bigint | null | Uint8Array;
export type InArgs = readonly InValue[];
export type InStatement = string | { sql: string; args?: InArgs };
export type Row = Record<string, unknown>;

export interface ResultSet {
  rows: Row[];
  rowsAffected: number;
  lastInsertRowid: number | bigint;
}

export interface Transaction {
  execute(statement: InStatement): Promise<ResultSet>;
  batch(statements: readonly InStatement[]): Promise<ResultSet[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
}

export interface Client {
  readonly dialect?: 'sqlite' | 'postgres';
  execute(statement: InStatement): Promise<ResultSet>;
  executeMultiple(sql: string): Promise<void>;
  batch(statements: readonly InStatement[], mode?: 'read' | 'write'): Promise<ResultSet[]>;
  transaction(mode?: 'read' | 'write'): Promise<Transaction>;
  close(): void;
}

function databasePathFromUrl(url: string): string {
  if (url === ':memory:' || url === 'file::memory:') return ':memory:';
  if (url.startsWith('file:')) return fileURLToPath(url);
  throw new Error('SQLite URL must be a local file: URL or :memory:.');
}

function normalize(statement: InStatement): { sql: string; args: InArgs } {
  return typeof statement === 'string'
    ? { sql: statement, args: [] }
    : { sql: statement.sql, args: statement.args ?? [] };
}

function executeSync(database: DatabaseSync, statement: InStatement): ResultSet {
  const { sql, args } = normalize(statement);
  const prepared = database.prepare(sql);
  if (prepared.columns().length > 0) {
    const rows = prepared.all(...args) as Row[];
    const returnedId = rows[0]?.id;
    return {
      rows,
      rowsAffected: 0,
      lastInsertRowid: typeof returnedId === 'number' || typeof returnedId === 'bigint' ? returnedId : 0n,
    };
  }
  const result = prepared.run(...args);
  return {
    rows: [],
    rowsAffected: Number(result.changes),
    lastInsertRowid: result.lastInsertRowid,
  };
}

class LocalTransaction implements Transaction {
  private finished = false;

  constructor(
    private readonly database: DatabaseSync,
    private readonly release: () => void,
  ) {}

  async execute(statement: InStatement): Promise<ResultSet> {
    if (this.finished) throw new Error('Transaction is already closed.');
    return executeSync(this.database, statement);
  }

  async batch(statements: readonly InStatement[]): Promise<ResultSet[]> {
    if (this.finished) throw new Error('Transaction is already closed.');
    return statements.map((statement) => executeSync(this.database, statement));
  }

  async commit(): Promise<void> {
    if (this.finished) return;
    try {
      this.database.exec('COMMIT');
    } finally {
      this.finished = true;
      this.release();
    }
  }

  async rollback(): Promise<void> {
    if (this.finished) return;
    try {
      this.database.exec('ROLLBACK');
    } finally {
      this.finished = true;
      this.release();
    }
  }

  close(): void {
    if (!this.finished) {
      try {
        this.database.exec('ROLLBACK');
      } finally {
        this.finished = true;
        this.release();
      }
    }
  }
}

class LocalClient implements Client {
  readonly dialect = 'sqlite' as const;
  private readonly database: DatabaseSync;
  private gate: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(url: string) {
    this.database = new DatabaseSync(databasePathFromUrl(url));
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('Database client is closed.');
  }

  private async waitForTransaction(): Promise<void> {
    await this.gate;
    this.ensureOpen();
  }

  async execute(statement: InStatement): Promise<ResultSet> {
    await this.waitForTransaction();
    return executeSync(this.database, statement);
  }

  async executeMultiple(sql: string): Promise<void> {
    await this.waitForTransaction();
    this.database.exec(sql);
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

  async transaction(mode: 'read' | 'write' = 'write'): Promise<Transaction> {
    this.ensureOpen();
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      this.ensureOpen();
      this.database.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      return new LocalTransaction(this.database, release);
    } catch (error) {
      release();
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

export function createClient(options: { url: string }): Client {
  return new LocalClient(options.url);
}
