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
 * request. Both authenticated user and tenant context are bound locally to
 * the transaction so RLS policies and SECURITY DEFINER provisioning functions
 * have an authoritative server-side identity.
 */
export async function attachTenantScope(tenantId: string, res: Response, userId?: number): Promise<ScopedDb> {
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
    if (userId !== undefined) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
    }
  } catch (error) {
    client.release();
    throw error;
  }
  res.on('finish', () => void finish(res.statusCode < 400));
  res.on('close', () => void finish(false));
  return drizzle(client, { schema });
}
