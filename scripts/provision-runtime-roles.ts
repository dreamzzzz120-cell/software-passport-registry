/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provisions the least-privileged runtime roles without creating a password
 * drift between PostgreSQL and the connection URLs used by the services.
 *
 * Required env vars: DATABASE_URL and the runtime URL for this process role.
 * The app release provisions spr_app_runtime from APP_DATABASE_URL; the worker
 * release provisions spr_worker_runtime from WORKER_DATABASE_URL. Each service
 * owns its own credential, so an app deploy cannot rotate the worker's role
 * behind the worker's configured connection URL.
 */

import { Pool } from 'pg';

function passwordFromUrl(raw: string | undefined, variableName: string): string {
  if (!raw?.trim()) throw new Error(`${variableName} is required.`);
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`${variableName} must be a valid database URL.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${variableName} must use the postgres:// or postgresql:// scheme.`);
  }
  const password = decodeURIComponent(parsed.password);
  if (!password || password.length < 16) {
    throw new Error(`${variableName} must contain a database password of at least 16 characters.`);
  }
  return password;
}

async function setRolePassword(pool: Pool, role: 'spr_app_runtime' | 'spr_worker_runtime', password: string) {
  // Role names are fixed literals, not user input; ALTER ROLE cannot bind its
  // password argument as a query parameter, so the password is quote-escaped.
  await pool.query(`ALTER ROLE ${role} WITH PASSWORD '${password.replace(/'/g, "''")}'`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required (must be the owner/migrator connection).');

  const isWorker = process.env.PROCESS_ROLE?.trim() === 'worker';
  const runtimeRole = isWorker ? 'spr_worker_runtime' : 'spr_app_runtime';
  const runtimeUrlName = isWorker ? 'WORKER_DATABASE_URL' : 'APP_DATABASE_URL';
  const explicitWorkerPassword = isWorker ? process.env.WORKER_RUNTIME_DB_PASSWORD?.trim() : undefined;
  if (explicitWorkerPassword && explicitWorkerPassword.length < 16) {
    throw new Error('WORKER_RUNTIME_DB_PASSWORD must contain at least 16 characters.');
  }
  const runtimePassword = explicitWorkerPassword ?? passwordFromUrl(process.env[runtimeUrlName], runtimeUrlName);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const roles = await pool.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('spr_app_runtime', 'spr_worker_runtime')`,
    );
    const roleNames = new Set(roles.rows.map((row) => row.rolname));
    if (!roleNames.has(runtimeRole)) throw new Error(`Role ${runtimeRole} does not exist yet; run migrations first.`);

    await setRolePassword(pool, runtimeRole, runtimePassword);

    console.log(`[ProvisionRuntimeRoles] Runtime credentials synchronized for ${runtimeRole}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[ProvisionRuntimeRoles] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
