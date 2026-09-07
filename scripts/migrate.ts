/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPR Database Migration Runner
 *
 * Transaction-safe, idempotent, audit-friendly migration execution.
 */

import { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface MigrationRecord {
  version: string;
  description: string;
  executed_at: string;
  execution_duration_ms: number | null;
}

interface MigrationRunResult {
  success: boolean;
  executed: number;
  skipped: number;
  errors: string[];
  /** Tables the migrations create that are absent from the database. */
  missingTables: string[];
  /** Canonical hash of the live schema, or null if the check could not run. */
  schemaFingerprint: string | null;
}

interface MigrationFile {
  version: string;
  description: string;
  filePath: string;
  sql: string;
}

const MIGRATION_ADVISORY_LOCK = 0x5350524d;

function normalizeMigrationSql(sql: string): string {
  const withoutBegin = sql.replace(/^\s*(?:(?:--[^\r\n]*\r?\n)\s*)*BEGIN\s*;\s*/i, '');
  return withoutBegin.replace(/\r?\n\s*COMMIT\s*;\s*(?:\r?\n|--[\s\S]*)?$/i, '\n');
}

export class MigrationRunner {
  constructor(private readonly pool: Pool, private readonly migrationsDir: string, private readonly verbose = false) {}

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (level === 'info' && !this.verbose) return;
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
  }

  async initializeMigrationTable(client: PoolClient): Promise<void> {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, description text NOT NULL, executed_at timestamp DEFAULT CURRENT_TIMESTAMP, execution_duration_ms integer);`);
  }

  async loadMigrations(): Promise<MigrationFile[]> {
    const files = fs.readdirSync(this.migrationsDir).filter((file) => file.endsWith('.sql')).sort();
    return files.flatMap((file) => {
      const match = file.match(/^(\d{4})_(.+)\.sql$/);
      if (!match) {
        this.log(`Skipping invalid migration filename: ${file}`, 'warn');
        return [];
      }
      const filePath = path.join(this.migrationsDir, file);
      return [{ version: match[1], description: match[2].replace(/_/g, ' '), filePath, sql: fs.readFileSync(filePath, 'utf8') }];
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
    await client.query(`INSERT INTO schema_migrations (version, description, execution_duration_ms) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`, [migration.version, migration.description, duration]);
  }

  async executeMigration(client: PoolClient, migration: MigrationFile): Promise<number> {
    const start = Date.now();
    this.log(`Executing migration ${migration.version}: ${migration.description}`);
    await client.query(normalizeMigrationSql(migration.sql));
    const duration = Date.now() - start;
    this.log(`Migration ${migration.version} completed in ${duration}ms`);
    return duration;
  }

  async runPendingMigrations(): Promise<MigrationRunResult> {
    const client = await this.pool.connect();
    const errors: string[] = [];
    let executed = 0;
    let completed = new Set<string>();
    let lockHeld = false;
    try {
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
      const missingTables = await this.auditSchemaDrift(client, migrations).catch((error) => {
        // The audit must never be the reason a release fails.
        this.log(`Schema drift audit could not run: ${error instanceof Error ? error.message : String(error)}`, 'warn');
        return [] as string[];
      });
      const fingerprint = await this.schemaFingerprint(client).catch((error) => {
        this.log(`Schema fingerprint could not run: ${error instanceof Error ? error.message : String(error)}`, 'warn');
        return null;
      });
      // Per-object hashes go to the log, not the JSON result, so a diff can
      // localise drift to a single table, function, sequence or enum without
      // making the release output unreadable. SCHEMA_FINGERPRINT_DETAIL=false
      // silences them.
      if (fingerprint && process.env.SCHEMA_FINGERPRINT_DETAIL !== 'false') {
        const lines = Object.entries(fingerprint.objects).map(([object, hash]) => `  ${object} ${hash}`);
        console.log(`[schema-fingerprint] ${Object.keys(fingerprint.objects).length} objects\n${lines.join('\n')}`);
      }
      return {
        success: errors.length === 0,
        executed,
        skipped: Math.max(0, completed.size - executed),
        errors,
        missingTables,
        schemaFingerprint: fingerprint?.overall ?? null,
      };
    } finally {
      if (lockHeld) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK]).catch(() => undefined);
      client.release();
    }
  }

  /**
   * Read-only check that the schema actually contains what the migrations say
   * they created.
   *
   * The ledger is not evidence. traffic_events was recorded as created by
   * 0045 and reported "skipped" on every deploy, while the table did not exist
   * in production -- the failure only surfaced as a 42P01 at request time, on
   * a route that had been answering 503 site-wide. A runner that trusts its
   * own ledger cannot detect that, so it verifies instead.
   *
   * This deliberately does NOT fail the release. The extent of any existing
   * drift is unknown, and exiting non-zero here could block the very deploys
   * that carry the repairs. It reports, loudly, in the release output. Once a
   * clean run confirms no drift, flipping this to a hard failure is a one-line
   * change and is the right end state.
   */
  async auditSchemaDrift(client: PoolClient, migrations: MigrationFile[]): Promise<string[]> {
    const expected = new Set<string>();
    // CREATE TABLE [IF NOT EXISTS] [schema.]name, quoted or bare.
    const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi;
    // Comments are stripped first: prose like "-- create table for X" in a
    // migration header otherwise parses as a table named "for".
    const stripComments = (sql: string) =>
      sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
    for (const migration of migrations) {
      for (const match of stripComments(migration.sql).matchAll(pattern)) {
        if (match[1]) expected.add(match[1].toLowerCase());
      }
    }
    if (expected.size === 0) return [];

    const actual = new Set<string>();
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`
    );
    for (const row of result.rows as Array<{ table_name: string }>) {
      actual.add(String(row.table_name).toLowerCase());
    }

    const missing = [...expected].filter((table) => !actual.has(table)).sort();
    if (missing.length) {
      this.log(
        `SCHEMA DRIFT: ${missing.length} table(s) created by migrations are absent from the database: ${missing.join(', ')}`,
        'error'
      );
    }
    return missing;
  }

  /**
   * Canonical fingerprint of the live schema, per table and overall.
   *
   * Table existence is a weak guarantee: a table can be present while a column,
   * index, constraint, or -- most importantly here -- an RLS policy is not.
   * This product's tenant isolation is enforced by row-level security, so a
   * missing FORCE ROW LEVEL SECURITY or a dropped policy is a data-exposure
   * bug that the table-existence check would happily call healthy.
   *
   * Per table: columns (name, type, nullability, default), constraints
   * (primary key, foreign key, unique, check), indexes, triggers, whether RLS
   * is enabled and forced, every policy including its USING and WITH CHECK
   * expressions, and the table-level grants recorded against it. Also
   * fingerprinted, each as its own object rather than folded into a table:
   * every function and procedure (full definition, so a silently edited
   * function body -- e.g. spr_assert_tenant_rls() itself -- shows up as
   * drift), every sequence, and every enum type with its ordered labels.
   *
   * A GRANT is the difference between "least-privilege role configured" and
   * "least-privilege role actually holds only what it should" -- the same gap
   * the RLS policy coverage closed. information_schema.role_table_grants only
   * shows grants the connecting role can see (as grantor, grantee, or owner);
   * migrations run as the schema owner, which owns every table here, so this
   * sees every grant made on them. provision-runtime-roles.ts issues no GRANT
   * or REVOKE (only ALTER ROLE ... PASSWORD), so grants come solely from
   * migrations and a production database stays comparable against one built
   * fresh from the same files.
   *
   * Production cannot know the expected value, so this reports rather than
   * judges. Comparing a release log against the fingerprint of a database
   * freshly built from the same migrations turns "the tables are all there"
   * into "the schema is equivalent", and a per-object hash says exactly which
   * table, function, sequence or enum diverged.
   */
  async schemaFingerprint(client: PoolClient): Promise<{ overall: string; objects: Record<string, string> }> {
    const parts = new Map<string, string[]>();
    const add = (object: string, line: string) => {
      const key = String(object).toLowerCase();
      const bucket = parts.get(key);
      if (bucket) bucket.push(line);
      else parts.set(key, [line]);
    };

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable, coalesce(column_default, '') AS column_default
         FROM information_schema.columns
        WHERE table_schema = current_schema()
        ORDER BY table_name, column_name`
    );
    for (const r of columns.rows as Array<Record<string, string>>) {
      add(r.table_name, `col ${r.column_name} ${r.data_type} null=${r.is_nullable} default=${r.column_default}`);
    }

    const constraints = await client.query(
      `SELECT c.conrelid::regclass::text AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = current_schema()
        ORDER BY 1, 2`
    );
    for (const r of constraints.rows as Array<Record<string, string>>) {
      add(r.table_name.replace(/^.*\./, '').replace(/"/g, ''), `con ${r.conname} ${r.def}`);
    }

    const indexes = await client.query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY 1, 2`
    );
    for (const r of indexes.rows as Array<Record<string, string>>) {
      add(r.tablename, `idx ${r.indexname} ${r.indexdef}`);
    }

    const triggers = await client.query(
      `SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND NOT t.tgisinternal
        ORDER BY 1, 2`
    );
    for (const r of triggers.rows as Array<Record<string, string>>) {
      add(r.table_name, `trg ${r.tgname} ${r.def}`);
    }

    const rls = await client.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r'
        ORDER BY 1`
    );
    for (const r of rls.rows as Array<Record<string, unknown>>) {
      add(String(r.relname), `rls enabled=${r.relrowsecurity} forced=${r.relforcerowsecurity}`);
    }

    const policies = await client.query(
      `SELECT tablename, policyname, permissive, roles::text AS roles, cmd,
              coalesce(qual, '') AS qual, coalesce(with_check, '') AS with_check
         FROM pg_policies WHERE schemaname = current_schema() ORDER BY 1, 2`
    );
    for (const r of policies.rows as Array<Record<string, string>>) {
      add(r.tablename, `pol ${r.policyname} ${r.permissive} ${r.roles} ${r.cmd} using=${r.qual} check=${r.with_check}`);
    }

    const grants = await client.query(
      `SELECT table_name, grantee, privilege_type, is_grantable
         FROM information_schema.role_table_grants
        WHERE table_schema = current_schema()
        ORDER BY table_name, grantee, privilege_type`
    );
    for (const r of grants.rows as Array<Record<string, string>>) {
      add(r.table_name, `grant ${r.grantee} ${r.privilege_type} grantable=${r.is_grantable}`);
    }

    const sequences = await client.query(
      `SELECT sequence_name, data_type, start_value, minimum_value, maximum_value, increment, cycle_option
         FROM information_schema.sequences
        WHERE sequence_schema = current_schema()
        ORDER BY sequence_name`
    );
    for (const r of sequences.rows as Array<Record<string, string>>) {
      add(
        `sequence:${r.sequence_name}`,
        `seq ${r.data_type} start=${r.start_value} min=${r.minimum_value} max=${r.maximum_value} inc=${r.increment} cycle=${r.cycle_option}`
      );
    }

    const enums = await client.query(
      `SELECT t.typname, e.enumlabel
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema()
        ORDER BY t.typname, e.enumsortorder`
    );
    for (const r of enums.rows as Array<Record<string, string>>) {
      add(`enum:${r.typname}`, `label ${r.enumlabel}`);
    }

    // prokind IN ('f','p') is load-bearing, not tidiness. pg_get_functiondef
    // raises 42809 ("is an aggregate function") for aggregates and window
    // functions, and this whole method is wrapped in a catch that returns
    // null -- so a single CREATE AGGREGATE, or any extension installed into
    // this schema that ships one, would silently switch the entire drift
    // check off while the release still reported success. Verified: adding
    // one aggregate makes the unfiltered query throw 42809 and the filtered
    // one return normally.
    const functions = await client.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS def
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema() AND p.prokind IN ('f', 'p')
        ORDER BY p.proname, args`
    );
    for (const r of functions.rows as Array<Record<string, string>>) {
      add(`function:${r.proname}(${r.args})`, `fn ${r.def}`);
    }

    // Aggregates and window functions, which the query above must exclude.
    // Excluding them outright would leave them unwatched, so they are tracked
    // here by identity and kind instead -- everything pg_get_functiondef would
    // have refused to render, still visible as drift if one appears, changes
    // signature or disappears.
    const otherRoutines = await client.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prokind,
              pg_get_function_result(p.oid) AS result
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema() AND p.prokind NOT IN ('f', 'p')
        ORDER BY p.proname, args`
    );
    for (const r of otherRoutines.rows as Array<Record<string, string>>) {
      add(`routine:${r.proname}(${r.args})`, `kind=${r.prokind} returns=${r.result}`);
    }

    const objects: Record<string, string> = {};
    for (const [object, lines] of [...parts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      objects[object] = createHash('sha256').update(lines.sort().join('\n'), 'utf8').digest('hex').slice(0, 16);
    }
    const overall = createHash('sha256')
      .update(Object.entries(objects).map(([o, h]) => `${o}:${h}`).join('\n'), 'utf8')
      .digest('hex');
    return { overall, objects };
  }

  async getMigrationStatus(): Promise<MigrationRecord[]> {
    try {
      const result = await this.pool.query('SELECT version, description, executed_at, execution_duration_ms FROM schema_migrations ORDER BY version');
      return result.rows as MigrationRecord[];
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    }
  }
}

function buildPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const common = { max: Number(process.env.SQL_POOL_MAX || 10), connectionTimeoutMillis: Number(process.env.SQL_CONNECTION_TIMEOUT_MS || 10000), idleTimeoutMillis: Number(process.env.SQL_IDLE_TIMEOUT_MS || 30000), query_timeout: Number(process.env.SQL_QUERY_TIMEOUT_MS || 30000) };
  if (databaseUrl) return new Pool({ connectionString: databaseUrl, ...common });
  const host = process.env.SQL_HOST;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;
  const database = process.env.SQL_DB_NAME;
  if (!host || !user || !password || !database) throw new Error('Database configuration missing. Provide DATABASE_URL or SQL_HOST, SQL_USER, SQL_PASSWORD and SQL_DB_NAME.');
  const ssl = ['true', '1', 'require'].includes((process.env.SQL_SSL || '').trim().toLowerCase()) ? { rejectUnauthorized: true } : undefined;
  return new Pool({ host, user, password, database, ssl, ...common });
}

export async function main() {
  const pool = buildPool();
  try {
    const runner = new MigrationRunner(pool, process.env.MIGRATIONS_DIR || './migrations', process.env.VERBOSE === 'true');
    const result = await runner.runPendingMigrations();
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Production is bundled to CJS; local tsx execution is identified by argv[1].
// Avoid import.meta so the production CJS bundle has no import.meta warning.
const isDirectlyExecuted = typeof require !== 'undefined' && typeof module !== 'undefined'
  ? require.main === module
  : Boolean(process.argv[1]) && /(?:^|[\\/])migrate\.ts$/.test(process.argv[1]);
if (isDirectlyExecuted) {
  main().catch((error) => {
    console.error('[FATAL]', error);
    process.exit(1);
  });
}