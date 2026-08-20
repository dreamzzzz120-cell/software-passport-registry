import { Pool } from 'pg';

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export function createWorkerPool(): Pool {
  const mode = (process.env.SQL_SSL ?? '').trim().toLowerCase();
  const production = process.env.NODE_ENV === 'production';
  const ca = process.env.SQL_SSL_CA?.trim();
  const tlsModes = ['require', 'true', '1', 'verify', 'verify-full'];

  if (production && !tlsModes.includes(mode)) {
    throw new Error('WORKER_DB_TLS_REQUIRED: SQL_SSL must be require, verify, or verify-full in production');
  }
  if (['verify', 'verify-full'].includes(mode) && !ca) {
    throw new Error('WORKER_DB_TLS_CA_REQUIRED: SQL_SSL_CA is required for certificate verification');
  }

  const ssl = tlsModes.includes(mode)
    ? { rejectUnauthorized: ['verify', 'verify-full'].includes(mode), ...(ca ? { ca } : {}) }
    : undefined;
  const base = {
    ssl,
    max: parsePositiveInt(process.env.SQL_POOL_MAX, 4),
    connectionTimeoutMillis: parsePositiveInt(process.env.SQL_CONNECTION_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: parsePositiveInt(process.env.SQL_IDLE_TIMEOUT_MS, 30_000),
    query_timeout: parsePositiveInt(process.env.SQL_QUERY_TIMEOUT_MS, 5_000),
    allowExitOnIdle: false,
  } as const;

  const connectionString = process.env.DATABASE_URL?.trim();
  const pool = connectionString
    ? new Pool({ connectionString, ...base })
    : new Pool({ host: process.env.SQL_HOST, user: process.env.SQL_USER, password: process.env.SQL_PASSWORD, database: process.env.SQL_DB_NAME, ...base });

  pool.on('error', (error) => console.error('[Worker][DB] idle client error:', error instanceof Error ? error.message : String(error)));
  return pool;
}

export async function assertWorkerDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}
