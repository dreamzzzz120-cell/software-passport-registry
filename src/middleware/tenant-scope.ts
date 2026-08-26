/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Response } from 'express';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { appPool } from '../db/index.ts';
import * as schema from '../db/schema.ts';

export type ScopedDb = NodePgDatabase<typeof schema>;

/**
 * Opens one transaction on the tenant-scoped pool for the lifetime of a single
 * request and binds `app.tenant_id` for that transaction via set_config(), so
 * every Row-Level Security policy created in migration 0020 filters to exactly
 * this tenant. The transaction commits when the response finishes successfully
 * and rolls back on error or premature disconnect; the client is always
 * released back to the pool exactly once.
 */
export async function attachTenantScope(tenantId: string, res: Response): Promise<ScopedDb> {
  const client = await appPool.connect();
  let settled = false;
  const finish = async (commit: boolean) => {
    if (settled) return;
    settled = true;
    try {
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    } catch (error) {
      console.error('[TenantScope] finalize error:', error instanceof Error ? error.message : String(error));
    } finally {
      client.release();
    }
  };
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  } catch (error) {
    client.release();
    throw error;
  }
  res.on('finish', () => void finish(res.statusCode < 400));
  res.on('close', () => void finish(false));
  return drizzle(client, { schema });
}
