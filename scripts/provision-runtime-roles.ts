/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provisions the least-privileged runtime roles without creating a password
 * drift between PostgreSQL and the connection URLs used by the services.
 *
 * Required env vars: DATABASE_URL and APP_DATABASE_URL. If
 * WORKER_DATABASE_URL is configured, its password is synchronized to the
 * worker role as well. The runtime URLs remain the source of truth for their
 * corresponding service credentials; this prevents every release from
 * rotating a role password behind a static Railway connection URL.
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

  const appPassword = passwordFromUrl(process.env.APP_DATABASE_URL, 'APP_DATABASE_URL');
  const workerUrl = process.env.WORKER_DATABASE_URL?.trim();
  const workerPassword = workerUrl ? passwordFromUrl(workerUrl, 'WORKER_DATABASE_URL') : undefined;

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const roles = await pool.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('spr_app_runtime', 'spr_worker_runtime')`,
    );
    const roleNames = new Set(roles.rows.map((row) => row.rolname));
    if (!roleNames.has('spr_app_runtime')) throw new Error('Role spr_app_runtime does not exist yet; run migrations first.');
    if (!roleNames.has('spr_worker_runtime')) throw new Error('Role spr_worker_runtime does not exist yet; run migrations first.');

    await setRolePassword(pool, 'spr_app_runtime', appPassword);
    if (workerPassword) await setRolePassword(pool, 'spr_worker_runtime', workerPassword);

    console.log(`[ProvisionRuntimeRoles] Runtime credentials synchronized for spr_app_runtime${workerPassword ? ' and spr_worker_runtime' : ''}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[ProvisionRuntimeRoles] Failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
