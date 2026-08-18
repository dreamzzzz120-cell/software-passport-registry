/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SPR Database Migration Runner
 * 
 * This migration runner is:
 * - IDEMPOTENT: Can be run multiple times safely
 * - SAFE: Uses schema_migrations ledger to track executed migrations
 * - NON-DESTRUCTIVE: Does not perform DROP, TRUNCATE, DELETE, or UPDATE operations on user data
 * - TRANSACTIONAL: Each migration runs in its own transaction with automatic rollback on failure
 * - AUDIT-FRIENDLY: Logs all operations for compliance and debugging
 */

import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

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

/**
 * MigrationRunner orchestrates database schema migrations.
 * It ensures:
 * 1. schema_migrations table exists for tracking
 * 2. Only new migrations are executed
 * 3. All operations are logged
 * 4. Failures are explicit and non-silent
 */
export class MigrationRunner {
  private pool: Pool;
  private migrationsDir: string;
  private verbose: boolean;

  constructor(pool: Pool, migrationsDir: string, verbose: boolean = false) {
    this.pool = pool;
    this.migrationsDir = migrationsDir;
    this.verbose = verbose;
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    console.log(`${prefix} ${message}`);
  }

  /**
   * Initialize the migration tracking table if it doesn't exist.
   * This is idempotent.
   */
  async initializeMigrationTable(client: PoolClient): Promise<void> {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version text PRIMARY KEY,
          description text NOT NULL,
          executed_at timestamp DEFAULT CURRENT_TIMESTAMP,
          execution_duration_ms integer
        );
      `);
      this.log('Migration tracking table initialized');
    } catch (err) {
      throw new Error(`Failed to initialize migration table: ${err}`);
    }
  }

  /**
   * Load all migration files from the migrations directory.
   * Files must be named: NNNN_description.sql
   */
  async loadMigrations(): Promise<MigrationFile[]> {
    try {
      const files = fs.readdirSync(this.migrationsDir);
      const migrationFiles = files
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const migrations: MigrationFile[] = [];
      for (const file of migrationFiles) {
        const filePath = path.join(this.migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        const match = file.match(/^(\d{4})_(.+)\.sql$/);
        if (!match) {
          this.log(`Skipping file with invalid naming: ${file}`, 'warn');
          continue;
        }
        const [, version, description] = match;
        migrations.push({
          version,
          description: description.replace(/_/g, ' '),
          filePath,
          sql,
        });
      }

      this.log(`Loaded ${migrations.length} migration files`);
      return migrations;
    } catch (err) {
      throw new Error(`Failed to load migrations: ${err}`);
    }
  }

  /**
   * Get the set of already-executed migrations from the tracking table.
   */
  async getExecutedMigrations(client: PoolClient): Promise<Set<string>> {
    try {
      const result = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version'
      );
      return new Set(result.rows.map((row) => row.version));
    } catch (err) {
      // If table doesn't exist, return empty set (will be created during migration)
      if ((err as any).code === '42P01') {
        return new Set();
      }
      throw new Error(`Failed to query executed migrations: ${err}`);
    }
  }

  /**
   * Record a migration as executed in the tracking table.
   * Uses INSERT ON CONFLICT to handle idempotency.
   */
  async recordMigration(
    client: PoolClient,
    version: string,
    description: string,
    duration: number
  ): Promise<void> {
    try {
      await client.query(
        `INSERT INTO schema_migrations (version, description, execution_duration_ms)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO NOTHING`,
        [version, description, duration]
      );
    } catch (err) {
      throw new Error(`Failed to record migration ${version}: ${err}`);
    }
  }

  /**
   * Execute a single migration SQL file.
   * Runs in its own transaction with automatic rollback on failure.
   */
  async executeMigration(
    client: PoolClient,
    migration: MigrationFile
  ): Promise<number> {
    const startTime = Date.now();
    try {
      this.log(`Executing migration ${migration.version}: ${migration.description}`);

      // Execute the SQL file
      // Note: We assume each migration file contains properly formed SQL.
      // If it contains multiple statements, they should be separated by semicolons.
      await client.query(migration.sql);

      const duration = Date.now() - startTime;
      this.log(
        `✓ Migration ${migration.version} completed successfully (${duration}ms)`
      );
      return duration;
    } catch (err) {
      throw new Error(
        `Migration ${migration.version} failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  /**
   * Run all pending migrations.
   * This is the main entry point for the migration system.
   */
  async runPendingMigrations(): Promise<{
    success: boolean;
    executed: number;
    skipped: number;
    errors: string[];
  }> {
    const client = await this.pool.connect();
    const errors: string[] = [];
    let executed = 0;
    let skipped = 0;

    try {
      // Step 1: Initialize migration tracking table
      await this.initializeMigrationTable(client);

      // Step 2: Load all migration files
      const allMigrations = await this.loadMigrations();
      if (allMigrations.length === 0) {
        this.log('No migrations found in directory', 'warn');
        return { success: true, executed: 0, skipped: 0, errors: [] };
      }

      // Step 3: Get already-executed migrations
      const executed_versions = await this.getExecutedMigrations(client);

      // Step 4: Identify pending migrations
      const pendingMigrations = allMigrations.filter(
        (m) => !executed_versions.has(m.version)
      );

      if (pendingMigrations.length === 0) {
        this.log('No pending migrations');
        return { success: true, executed: 0, skipped: 0, errors: [] };
      }

      this.log(`Found ${pendingMigrations.length} pending migrations`);

      // Step 5: Execute each pending migration
      for (const migration of pendingMigrations) {
        let txnClient: PoolClient | null = null;
        try {
          // Use a separate connection for each migration transaction
          txnClient = await this.pool.connect();

          // Start transaction
          await txnClient.query('BEGIN');

          // Execute migration
          const duration = await this.executeMigration(txnClient, migration);

          // Record in tracking table (within same transaction)
          await this.recordMigration(
            txnClient,
            migration.version,
            migration.description,
            duration
          );

          // Commit transaction
          await txnClient.query('COMMIT');
          executed++;
        } catch (err) {
          if (txnClient) {
            try {
              await txnClient.query('ROLLBACK');
            } catch (rollbackErr) {
              // Ignore rollback errors
            }
          }
          const errorMsg = `${migration.version}: ${err instanceof Error ? err.message : err}`;
          errors.push(errorMsg);
          this.log(errorMsg, 'error');
        } finally {
          if (txnClient) {
            txnClient.release();
          }
        }
      }

      skipped = executed_versions.size;

      // Step 6: Final summary
      if (errors.length === 0) {
        this.log(
          `Migration complete: ${executed} executed, ${skipped} previously executed`
        );
        return { success: true, executed, skipped, errors };
      } else {
        this.log(
          `Migration completed with ${errors.length} error(s)`,
          'error'
        );
        return { success: false, executed, skipped, errors };
      }
    } catch (err) {
      const errorMsg = `Migration runner failed: ${err instanceof Error ? err.message : err}`;
      errors.push(errorMsg);
      this.log(errorMsg, 'error');
      return { success: false, executed, skipped, errors };
    } finally {
      client.release();
    }
  }

  /**
   * Get the current migration status (what has been executed).
   * Useful for diagnostics and verification.
   */
  async getMigrationStatus(): Promise<MigrationRecord[]> {
    try {
      const result = await this.pool.query(
        'SELECT version, description, executed_at, execution_duration_ms FROM schema_migrations ORDER BY version'
      );
      return result.rows as MigrationRecord[];
    } catch (err) {
      // If table doesn't exist yet, return empty array
      if ((err as any).code === '42P01') {
        return [];
      }
      throw new Error(`Failed to get migration status: ${err}`);
    }
  }
}

/**
 * Build a PostgreSQL connection string from environment variables.
 * Supports both DATABASE_URL (new style) and SQL_* variables (legacy style).
 */
function buildConnectionString(): string {
  const databaseUrl = process.env.DATABASE_URL;
  
  // If DATABASE_URL is provided, use it directly
  if (databaseUrl) {
    return databaseUrl;
  }
  
  // Otherwise, construct from SQL_* environment variables (legacy style)
  const host = process.env.SQL_HOST;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;
  const database = process.env.SQL_DB_NAME;
  
  if (!host || !user || !password || !database) {
    const missing = [];
    if (!host) missing.push('SQL_HOST');
    if (!user) missing.push('SQL_USER');
    if (!password) missing.push('SQL_PASSWORD');
    if (!database) missing.push('SQL_DB_NAME');
    
    console.error(
      `[ERROR] DATABASE_URL not provided, and required SQL_* variables are missing: ${missing.join(', ')}`
    );
    console.error('[ERROR] Please provide EITHER:');
    console.error('  1. DATABASE_URL environment variable, OR');
    console.error('  2. All of: SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME');
    process.exit(1);
  }
  
  // Construct connection string
  // Handle Cloud SQL Unix socket paths (e.g., /cloudsql/project:region:instance)
  const connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${database}`;
  return connectionString;
}

/**
 * Main entry point for Cloud Run or local execution.
 * Environment variables (connection - choose one method):
 * METHOD 1 (new):
 *   - DATABASE_URL: PostgreSQL connection string (e.g., postgresql://user:pass@host/db)
 * METHOD 2 (legacy, supported for compatibility):
 *   - SQL_HOST: Database hostname or Unix socket path
 *   - SQL_USER: Database username
 *   - SQL_PASSWORD: Database password
 *   - SQL_DB_NAME: Database name
 * 
 * Additional options:
 *   - MIGRATIONS_DIR: Path to migrations directory (default: ./migrations)
 *   - VERBOSE: Set to 'true' for verbose logging (default: false)
 */
export async function main() {
  const connectionString = buildConnectionString();
  const migrationsDir = process.env.MIGRATIONS_DIR || './migrations';
  const verbose = process.env.VERBOSE === 'true';

  const pool = new Pool({ connectionString });

  try {
    const runner = new MigrationRunner(pool, migrationsDir, verbose);

    // Get pre-migration status
    console.log('\n=== Pre-Migration Status ===');
    const preMigrations = await runner.getMigrationStatus();
    if (preMigrations.length > 0) {
      console.log('Previously executed migrations:');
      preMigrations.forEach((m) => {
        console.log(
          `  ${m.version}: ${m.description} (${m.execution_duration_ms}ms)`
        );
      });
    } else {
      console.log('No migrations have been executed yet');
    }

    // Run pending migrations
    console.log('\n=== Running Migrations ===');
    const result = await runner.runPendingMigrations();

    // Get post-migration status
    console.log('\n=== Post-Migration Status ===');
    const postMigrations = await runner.getMigrationStatus();
    if (postMigrations.length > 0) {
      console.log('Executed migrations:');
      postMigrations.forEach((m) => {
        console.log(
          `  ${m.version}: ${m.description} (${m.execution_duration_ms}ms)`
        );
      });
    }

    // Final result
    console.log('\n=== Migration Result ===');
    console.log(`Success: ${result.success}`);
    console.log(`Executed: ${result.executed}`);
    console.log(`Previously executed: ${result.skipped}`);
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      result.errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
