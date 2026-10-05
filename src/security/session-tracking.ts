/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { appPool } from '../db/index.ts';
import * as schema from '../db/schema.ts';

export function sessionFingerprint(uid: string, ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(`${uid}:${ip}:${userAgent}`).digest('hex').slice(0, 40);
}

export function describeUserAgent(userAgent: string): string {
  const ua = userAgent || '';
  const os = /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /android/i.test(ua) ? 'Android'
    : /iphone|ipad/i.test(ua) ? 'iOS' : /linux/i.test(ua) ? 'Linux' : 'an unknown OS';
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox'
    : /safari\//i.test(ua) && !/chrome/i.test(ua) ? 'Safari' : 'an unknown browser';
  return `${browser} on ${os}`;
}

/**
 * Upserts the caller's device fingerprint into user_sessions and, only the
 * first time that fingerprint is seen, appends a login_history row. Session
 * revocation here is DB-side only: Firebase has no API to invalidate a single
 * refresh token, so "revoke" removes a device from this ledger rather than
 * force-logging it out immediately.
 */
export async function recordSession(db: ScopedDb, params: { tenantId: string; userId: number; uid: string; ip: string; userAgent: string }) {
  const fingerprint = sessionFingerprint(params.uid, params.ip, params.userAgent);
  const sessionId = `sess_${fingerprint}`;
  const inserted = await db.execute(sql`
    INSERT INTO user_sessions (id, tenant_id, user_id, session_fingerprint, ip, user_agent)
    VALUES (${sessionId}, ${params.tenantId}, ${params.userId}, ${fingerprint}, ${params.ip}, ${params.userAgent})
    ON CONFLICT (tenant_id, user_id, session_fingerprint) DO NOTHING
    RETURNING id
  `);
  const isNew = Boolean((inserted as any).rows?.length);
  await db.execute(sql`
    UPDATE user_sessions SET last_seen_at = NOW(), revoked_at = NULL
    WHERE tenant_id = ${params.tenantId} AND user_id = ${params.userId} AND session_fingerprint = ${fingerprint}
  `);
  if (isNew) {
    await db.execute(sql`
      INSERT INTO login_history (id, tenant_id, user_id, ip, user_agent, status)
      VALUES (${`login_${crypto.randomUUID().replace(/-/g, '')}`}, ${params.tenantId}, ${params.userId}, ${params.ip}, ${params.userAgent}, 'Verified')
    `);
  }
  return { sessionId, fingerprint };
}


/**
 * Records session telemetry on an independent tenant-scoped connection so an
 * optional audit write can never stall or poison the caller's authenticated
 * request transaction.
 */
export async function recordSessionDetached(params: { tenantId: string; userId: number; uid: string; ip: string; userAgent: string }) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [params.tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [String(params.userId)]);
    const scoped = drizzle(client, { schema }) as ScopedDb;
    const result = await recordSession(scoped, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
