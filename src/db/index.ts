/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import { config } from '../config.ts';

const getNumericEnv = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const isDatabaseConfigured = config.database.isConfigured;
export const databaseConfigurationSummary = {
  connectionString: config.database.connectionString ? '[configured]' : 'UNCONFIGURED',
  host: config.database.connectionString ? 'DATABASE_URL' : config.database.host || 'UNCONFIGURED',
  database: config.database.name || 'UNCONFIGURED',
  ssl: config.database.ssl,
  poolMax: getNumericEnv(config.database.poolMax?.toString(), 20),
  connectionTimeoutMillis: getNumericEnv(config.database.connectionTimeoutMs?.toString(), 10000),
  idleTimeoutMillis: getNumericEnv(config.database.idleTimeoutMs?.toString(), 30000),
  queryTimeoutMillis: getNumericEnv(config.database.queryTimeoutMs?.toString(), 5000),
};

export const createPool = () => {
  if (!isDatabaseConfigured) {
    console.warn('[Database] SQL configuration is incomplete. DB readiness will report DB_MISCONFIGURED until DATABASE_URL or SQL_HOST, SQL_USER, SQL_PASSWORD and SQL_DB_NAME are configured.');
  }

  const poolConfig = {
    connectionTimeoutMillis: databaseConfigurationSummary.connectionTimeoutMillis,
    max: databaseConfigurationSummary.poolMax,
    idleTimeoutMillis: databaseConfigurationSummary.idleTimeoutMillis,
    query_timeout: databaseConfigurationSummary.queryTimeoutMillis,
  };

  if (config.database.connectionString) {
    return new Pool({ connectionString: config.database.connectionString, ...poolConfig });
  }

  return new Pool({
    host: config.database.host,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    ssl: databaseConfigurationSummary.ssl ? { rejectUnauthorized: true } : undefined,
    ...poolConfig,
  });
};

export const pool = createPool();

pool.on('error', (err) => {
  console.error('[Database] Unexpected error on idle SQL pool client:', err?.message || err);
});

export async function checkDatabaseHealth(): Promise<{ ok: true; latencyMs: number } | { ok: false; latencyMs: number; error: string }> {
  const started = Date.now();
  if (!isDatabaseConfigured) return { ok: false, latencyMs: 0, error: 'DB_MISCONFIGURED' };
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export const db = drizzle(pool, { schema });
