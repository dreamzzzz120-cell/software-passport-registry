/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sets the login passwords for the least-privileged spr_app_runtime and
 * spr_worker_runtime roles created by migration 0020. Passwords are never
 * embedded in the migration itself; this script applies them from env vars
 * against whatever DATABASE_URL (the owner/migrator role) is already
 * configured. Run once after migrations, whenever a password is rotated, and
 * whenever a fresh database is provisioned.
 *
 * Required env vars: DATABASE_URL, APP_RUNTIME_DB_PASSWORD, WORKER_RUNTIME_DB_PASSWORD.
 */

import { Pool } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const appPassword = process.env.APP_RUNTIME_DB_PASSWORD?.trim();
  const workerPassword = process.env.WORKER_RUNTIME_DB_PASSWORD?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required (must be the owner/migrator connection).');
  if (!appPassword || appPassword.length < 16) throw new Error('APP_RUNTIME_DB_PASSWORD is required and must be at least 16 characters.');
  if (!workerPassword || workerPassword.length < 16) throw new Error('WORKER_RUNTIME_DB_PASSWORD is required and must be at least 16 characters.');

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['spr_app_runtime']).then(result => {
      if (!result.rows.length) throw new Error('Role spr_app_runtime does not exist yet; run migrations first.');
    });
    // Role names are fixed literals, not user input; ALTER ROLE cannot bind
    // its password argument as a query parameter, so it is quote-escaped here.
    await pool.query(`ALTER ROLE spr_app_runtime WITH PASSWORD '${appPassword.replace(/'/g, "''")}'`);
    await pool.query(`ALTER ROLE spr_worker_runtime WITH PASSWORD '${workerPassword.replace(/'/g, "''")}'`);
    console.log('[ProvisionRuntimeRoles] Passwords set for spr_app_runtime and spr_worker_runtime.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[ProvisionRuntimeRoles] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
