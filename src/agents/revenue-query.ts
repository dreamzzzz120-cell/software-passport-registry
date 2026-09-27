import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { findEvidenceBackedReviewCandidates } from './revenue-candidates.ts';

export const revenueQuery = z.object({ clientId: z.string().trim().min(1).max(255).optional(),
  findingId: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25) }).strict();

export async function listRevenueReviewCandidates(db: ScopedDb, tenantId: string, options: { clientId?: string; findingId?: string; limit: number }) {
  const clientFilter = options.clientId ?? null;
  const findingFilter = options.findingId ?? null;
  const limit = options.limit;
  const rows = (await db.execute(sql`SELECT f.id, f.passport_id AS "passportId", p.client_id AS "clientId",
    f.title, f.severity, f.status, f.evidence_ids AS "evidenceIds", f.updated_at AS "updatedAt"
    FROM trust_findings f JOIN passports p ON p.id=f.passport_id AND p.tenant_id=f.tenant_id
    WHERE f.tenant_id=${tenantId} AND lower(f.severity) IN ('critical','high')
    AND lower(f.status)='open' AND (${clientFilter}::text IS NULL OR p.client_id=${clientFilter})
    AND (${findingFilter}::text IS NULL OR f.id=${findingFilter})
    ORDER BY f.updated_at DESC, f.id ASC LIMIT ${limit + 1}`) as any).rows ?? [];
  const selected = rows.slice(0, limit);
  const passportIds = [...new Set(selected.map((row: any) => String(row.passportId)))];
  const evidence = passportIds.length ? (await db.execute(sql`SELECT id, passport_id AS "passportId", status,
    observed_at AS "observedAt", verification_method AS "verificationMethod", evidence_hash AS "evidenceHash"
    FROM evidence_ledger WHERE tenant_id=${tenantId}
    AND passport_id IN (${sql.join(passportIds.map(id => sql`${id}`), sql`, `)})
    ORDER BY observed_at DESC LIMIT 5000`) as any).rows ?? [] : [];
  const opportunities = findEvidenceBackedReviewCandidates(selected.map((row: any) => ({
    id: String(row.id), passportId: String(row.passportId), clientId: row.clientId == null ? null : String(row.clientId),
    title: String(row.title), severity: String(row.severity), status: String(row.status),
    evidenceIds: row.evidenceIds, updatedAt: row.updatedAt == null ? null : String(row.updatedAt)
  })), evidence.map((row: any) => ({
    id: String(row.id), passportId: String(row.passportId), status: String(row.status),
    observedAt: row.observedAt == null ? null : String(row.observedAt),
    verificationMethod: row.verificationMethod == null ? null : String(row.verificationMethod),
    evidenceHash: row.evidenceHash == null ? null : String(row.evidenceHash)
  })));
  return { schemaVersion: 'spr-revenue-candidates-v1', opportunities,
    estimatedValue: null, generatedAt: new Date().toISOString(),
    incomplete: rows.length > limit || evidence.length === 5000,
    limitation: 'A bounded read of recent findings and evidence; no sale, price, or customer approval is inferred.' };
}
