/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { AUDIT_TRAIL_GENESIS_HASH } from '../utils/initial-owner-bootstrap.ts';

export type AuditChainRow = {
  id: number;
  action: string;
  timestamp: string | Date;
  actor: string;
  payload: string;
  previousHash: string;
  currentHash: string;
};

function canonicalTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('AUDIT_CHAIN_INVALID_TIMESTAMP');
  return date.toISOString();
}

const AUDIT_MAX_PAYLOAD_BYTES = 32 * 1024;
const AUDIT_MAX_DEPTH = 8;
const AUDIT_SECRET_KEY = /token|secret|password|api[_-]?key|private[_-]?key|credential|authorization|cookie|session|set-cookie|service[_-]?account/i;

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > AUDIT_MAX_DEPTH) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return value.length > 4096 ? `${value.slice(0, 4096)}[TRUNCATED]` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 256).map(item => sanitizeAuditValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 256)) {
      out[key] = AUDIT_SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeAuditValue(item, depth + 1);
    }
    return out;
  }
  return '[UNSUPPORTED_VALUE]';
}

export function sanitizeAuditPayload(payload: Record<string, unknown>): string {
  const sanitized = JSON.stringify(sanitizeAuditValue(payload)) ?? '{}';
  if (Buffer.byteLength(sanitized, 'utf8') > AUDIT_MAX_PAYLOAD_BYTES) {
    return JSON.stringify({ _audit: 'PAYLOAD_TRUNCATED', sha256: crypto.createHash('sha256').update(sanitized).digest('hex') });
  }
  return sanitized;
}

function computeHash(action: string, timestamp: string | Date, actor: string, payload: string, previousHash: string) {
  return crypto
    .createHash('sha256')
    .update(action + canonicalTimestamp(timestamp) + actor + payload + previousHash, 'utf8')
    .digest('hex');
}

/** Appends one block to the tenant's audit_trail hash chain (see migration 0000). */
export async function appendAuditEntry(
  db: ScopedDb,
  params: { tenantId: string; action: string; actor: string; payload: Record<string, unknown> },
) {
  const timestamp = new Date().toISOString();
  const payloadJson = sanitizeAuditPayload(params.payload ?? {});
  const last = await db.execute(
    sql`SELECT current_hash AS "currentHash" FROM audit_trail WHERE tenant_id = ${params.tenantId} ORDER BY id DESC LIMIT 1`,
  );
  const previousHash = (last as any).rows?.[0]?.currentHash ?? AUDIT_TRAIL_GENESIS_HASH;
  const currentHash = computeHash(params.action, timestamp, params.actor, payloadJson, previousHash);
  await db.execute(sql`
    INSERT INTO audit_trail (tenant_id, action, timestamp, actor, payload, previous_hash, current_hash)
    VALUES (${params.tenantId}, ${params.action}, ${timestamp}, ${params.actor}, ${payloadJson}, ${previousHash}, ${currentHash})
  `);
}

/**
 * Same hash chain as appendAuditEntry, for the worker execution context.
 * Workers (osv-worker.ts, trust-monitoring-worker.ts, etc.) hold a plain
 * pg.Pool from createWorkerPool() -- there is no per-request ScopedDb with a
 * drizzle sql`` tag out there, and no HTTP request to derive an actor
 * identity from. Reuses the exact same computeHash/canonicalTimestamp so a
 * chain that has entries from both an HTTP request and a background worker
 * verifies identically either way.
 */
export async function appendAuditEntryViaPool(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  params: { tenantId: string; action: string; actor: string; payload: Record<string, unknown> },
) {
  const timestamp = new Date().toISOString();
  const payloadJson = sanitizeAuditPayload(params.payload ?? {});
  const last = await pool.query(
    'SELECT current_hash AS "currentHash" FROM audit_trail WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1',
    [params.tenantId],
  );
  const previousHash = last.rows?.[0]?.currentHash ?? AUDIT_TRAIL_GENESIS_HASH;
  const currentHash = computeHash(params.action, timestamp, params.actor, payloadJson, previousHash);
  await pool.query(
    'INSERT INTO audit_trail (tenant_id, action, timestamp, actor, payload, previous_hash, current_hash) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [params.tenantId, params.action, timestamp, params.actor, payloadJson, previousHash, currentHash],
  );
}

/**
 * Recomputes every block in order and checks both stored hash and predecessor linkage.
 * Never throws for ordinary integrity failures: callers receive a deterministic INVALID result.
 */
export async function verifyAuditChain(db: ScopedDb, tenantId: string) {
  const result = await db.execute(sql`
    SELECT id, action, timestamp, actor, payload, previous_hash AS "previousHash", current_hash AS "currentHash"
    FROM audit_trail WHERE tenant_id = ${tenantId} ORDER BY id ASC
  `);
  const rows = ((result as any).rows ?? []) as AuditChainRow[];
  let expectedPrevious = AUDIT_TRAIL_GENESIS_HASH;
  let brokenAt: number | null = null;
  let failureReason: string | undefined;
  const details: Array<{ id: number; action: string; storedHash: string; valid: boolean }> = [];

  for (const row of rows) {
    let valid = false;
    try {
      const timestamp = canonicalTimestamp(row.timestamp);
      const recomputed = computeHash(row.action, timestamp, row.actor, row.payload, expectedPrevious);
      valid = recomputed === row.currentHash && row.previousHash === expectedPrevious;
      if (!valid && !failureReason) {
        failureReason = recomputed === row.currentHash
          ? 'PREVIOUS_HASH_MISMATCH'
          : 'CURRENT_HASH_MISMATCH';
      }
    } catch (error) {
      valid = false;
      if (!failureReason) failureReason = error instanceof Error ? error.message : 'AUDIT_CHAIN_INVALID_BLOCK';
    }
    details.push({ id: row.id, action: row.action, storedHash: row.currentHash, valid });
    if (!valid && brokenAt === null) brokenAt = row.id;
    expectedPrevious = row.currentHash;
  }

  return {
    isValid: brokenAt === null,
    status: brokenAt === null ? 'VALID' as const : 'INVALID' as const,
    verifiedAt: new Date().toISOString(),
    totalBlocksVerified: rows.length,
    error: brokenAt === null ? undefined : `Hash chain integrity check failed at block #${brokenAt}.`,
    failureReason,
    details: details.slice(-20),
  };
}
