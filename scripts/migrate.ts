/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPR Database Migration Runner
 *
 * Transaction-safe, idempotent, audit-friendly migration execution.
 */

import { Pool, PoolClient } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface MigrationRecord {
  version: string;
  description: string;
  executed_at: string;
  execution_duration_ms: number | null;
}

interface MigrationFile {
  version: string;
  description: string;
  filePath: string;
  sql: string;
}

const MIGRATION_ADVISORY_LOCK = 0x5350524d; // "SPRM"

function normalizeMigrationSql(sql: string): string {
  const withoutBegin = sql.replace(/^\s*(?:(?:--[^\r\n]*\r?\n)\s*)*BEGIN\s*;\s*/i, '');
  return withoutBegin.replace(/\r?\n\s*COMMIT\s*;\s*(?:\r?\n|--[\s\S]*)?$/i, '\n');
}

export class MigrationRunner {
  constructor(
    private readonly pool: Pool,
    private readonly migrationsDir: string,
    private readonly verbose = false,
  ) {}

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (level === 'info' && !this.verbose) return;
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
  }

  async initializeMigrationTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        description text NOT NULL,
        executed_at timestamp DEFAULT CURRENT_TIMESTAMP,
        execution_duration_ms integer
      );
    `);
  }

  async loadMigrations(): Promise<MigrationFile[]> {
    const files = fs.readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    return files.flatMap((file) => {
      const match = file.match(/^(\d{4})_(.+)\.sql$/);
      if (!match) {
        this.log(`Skipping invalid migration filename: ${file}`, 'warn');
        return [];
      }
      const filePath = path.join(this.migrationsDir, file);
      return [{
        version: match[1],
        description: match[2].replace(/_/g, ' '),
        filePath,
        sql: fs.readFileSync(filePath, 'utf8'),
      }];
    });
  }

  async getExecutedMigrations(client: PoolClient): Promise<Set<string>> {
    try {
      const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
      return new Set(result.rows.map((row) => row.version as string));
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return new Set();
      throw error;
    }
  }

  async recordMigration(client: PoolClient, migration: MigrationFile, duration: number): Promise<void> {
    await client.query(
      `INSERT INTO schema_migrations (version, description, execution_duration_ms)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO NOTHING`,
      [migration.version, migration.description, duration],
    );
  }

  async executeMigration(client: PoolClient, migration: MigrationFile): Promise<number> {
    const start = Date.now();
    this.log(`Executing migration ${migration.version}: ${migration.description}`);
    await client.query(normalizeMigrationSql(migration.sql));
    const duration = Date.now() - start;
    this.log(`Migration ${migration.version} completed in ${duration}ms`);
    return duration;
  }

  async runPendingMigrations(): Promise<{ success: boolean; executed: number; skipped: number; errors: string[] }> {
    const client = await this.pool.connect();
    const errors: string[] = [];
    let executed = 0;
    let completed = new Set<string>();
    let lockHeld = false;

    try {
      // Advisory locks are connection-scoped. Holding this same client for the
      // complete migration sequence prevents two Railway/Cloud Run instances
      // from racing on schema_migrations or applying the same DDL concurrently.
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK]);
      lockHeld = true;
      await this.initializeMigrationTable(client);
      const migrations = await this.loadMigrations();
      completed = await this.getExecutedMigrations(client);
      const pending = migrations.filter((migration) => !completed.has(migration.version));

      for (const migration of pending) {
        try {
          await client.query('BEGIN');
          const duration = await this.executeMigration(client, migration);
          await this.recordMigration(client, migration, duration);
          await client.query('COMMIT');
          completed.add(migration.version);
          executed += 1;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const message = `${migration.version}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(message);
          this.log(message, 'error');
          break;
        }
      }

      return { success: errors.length === 0, executed, skipped: Math.max(0, completed.size - executed), errors };
    } finally {
      if (lockHeld) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK]).catch(() => undefined);
      client.release();
    }
  }

  async getMigrationStatus(): Promise<MigrationRecord[]> {
    try {
      const result = await this.pool.query(
        'SELECT version, description, executed_at, execution_duration_ms FROM schema_migrations ORDER BY version',
      );
      return result.rows as MigrationRecord[];
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    }
  }
}

function buildPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const common = {
    max: Number(process.env.SQL_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.SQL_CONNECTION_TIMEOUT_MS || 10000),
    idleTimeoutMillis: Number(process.env.SQL_IDLE_TIMEOUT_MS || 30000),
    query_timeout: Number(process.env.SQL_QUERY_TIMEOUT_MS || 30000),
  };

  if (databaseUrl) return new Pool({ connectionString: databaseUrl, ...common });

  const host = process.env.SQL_HOST;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;
  const database = process.env.SQL_DB_NAME;
  if (!host || !user || !password || !database) {
    throw new Error('Database configuration missing. Provide DATABASE_URL or SQL_HOST, SQL_USER, SQL_PASSWORD and SQL_DB_NAME.');
  }

  const ssl = ['true', '1', 'require'].includes((process.env.SQL_SSL || '').trim().toLowerCase())
    ? { rejectUnauthorized: true }
    : undefined;

  return new Pool({ host, user, password, database, ssl, ...common });
}

export async function main() {
  const pool = buildPool();
  try {
    const runner = new MigrationRunner(
      pool,
      process.env.MIGRATIONS_DIR || './migrations',
      process.env.VERBOSE === 'true',
    );
    const result = await runner.runPendingMigrations();
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// esbuild bundles this to a real CJS module for production (dist/migrate.cjs),
// where require/module are genuine globals and its import.meta.url shim is not
// reliable; require.main is the correct, robust check there. tsx runs this file
// directly as native ESM for local dev (npm run migrate), where require/module
// are not defined, so fall back to comparing import.meta.url against argv[1].
const isDirectlyExecuted = typeof require !== 'undefined' && typeof module !== 'undefined'
  ? require.main === module
  : Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error('[FATAL]', error);
    process.exit(1);
  });
}
