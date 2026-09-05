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
  sslVerification: config.database.sslVerify,
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

  // SQL_SSL=require means encrypted transport without certificate verification.
  // SQL_SSL=verify/verify-full requires a trusted CA. Never silently downgrade
  // an explicitly requested verification mode.
  const sslConfig = config.database.ssl
    ? {
        rejectUnauthorized: config.database.sslVerify,
        ...(config.database.sslCa ? { ca: config.database.sslCa } : {}),
      }
    : undefined;

  if (config.database.connectionString) {
    // Pass an explicit SSL object so pg cannot inherit a weaker/ambiguous URL
    // setting. Certificate verification is controlled only by SQL_SSL/SQL_SSL_CA.
    return new Pool({ connectionString: config.database.connectionString, ssl: sslConfig, ...poolConfig });
  }

  return new Pool({
    host: config.database.host,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    ssl: sslConfig,
    ...poolConfig,
  });
};

export const pool = createPool();

pool.on('error', (err) => {
  console.error('[Database] Unexpected error on idle SQL pool client:', err?.message || err);
});

// Separate pool for the per-request, tenant-scoped connection used by the HTTP
// API (see src/middleware/tenant-scope.ts). It targets APP_DATABASE_URL when an
// operator has provisioned the least-privileged spr_app_runtime role (migration
// 0020); otherwise it falls back to the same owner connection as `pool`, which
// is a no-op for Row-Level Security since table owners bypass RLS entirely.
// Do NOT put an `sslmode=` parameter in DATABASE_URL, APP_DATABASE_URL or
// WORKER_DATABASE_URL. pg 8.23 treats sslmode=prefer/require/verify-ca as
// aliases for verify-full and builds its own TLS options from the URL, which
// takes precedence over the `ssl` object below -- so the CA configured here
// never reaches the handshake and the connection dies with "self-signed
// certificate in certificate chain".
//
// That is not hypothetical. On 2026-09-05 APP_DATABASE_URL carried
// `?sslmode=require`; the app pool could not connect, /ready reported
// runtimeRole null, the Railway healthcheck failed, and six consecutive deploys
// were rejected while the previous instance kept serving in a degraded state.
// The owner URL had no sslmode and connected fine, which is why exactly one of
// the two pools was broken.
//
// TLS is configured here instead, from SQL_SSL and SQL_SSL_CA. The correct
// posture is real verification: SQL_SSL=verify-full with SQL_SSL_CA holding the
// actual CA that issued the server certificate. The Railway Postgres leaf is
// CN=localhost issued by CN=root-ca, and its SAN does include
// postgres.railway.internal, so verify-full genuinely passes against the real
// CA -- verified against production before it was enabled. Do not "fix" a TLS
// failure here by dropping rejectUnauthorized to false or supplying a
// placeholder CA; that trades a real guarantee for a green healthcheck.
const sslConfigFor = (connectionString: string | undefined) => config.database.ssl
  ? { rejectUnauthorized: config.database.sslVerify, ...(config.database.sslCa ? { ca: config.database.sslCa } : {}) }
  : undefined;
export const appPool = config.database.appConnectionString
  ? new Pool({
      connectionString: config.database.appConnectionString,
      ssl: sslConfigFor(config.database.appConnectionString),
      connectionTimeoutMillis: databaseConfigurationSummary.connectionTimeoutMillis,
      max: databaseConfigurationSummary.poolMax,
      idleTimeoutMillis: databaseConfigurationSummary.idleTimeoutMillis,
      query_timeout: databaseConfigurationSummary.queryTimeoutMillis,
    })
  : pool;
if (appPool !== pool) appPool.on('error', (err) => console.error('[Database] Unexpected error on idle app-runtime pool client:', err?.message || err));

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
  if (appPool !== pool) await appPool.end();
}

export const db = drizzle(pool, { schema });
