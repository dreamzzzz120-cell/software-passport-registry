import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';

function parseJson(value: unknown, fallback: any) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function createPublicConnectRouter() {
  const router = Router();
  router.get('/public/v1/passports/:id/trust', async (req, res) => {
    const result = await db.execute(sql`
      SELECT id, name, version, overall_score, security_score, compliance_score, vendor_reputation_score, evidence, vulnerabilities
      FROM passports WHERE id = ${req.params.id} LIMIT 1
    `);
    const row: any = (result as any).rows?.[0];
    if (!row) return res.status(404).json({ error: 'Passport not found' });
    res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({
      passportId: row.id,
      name: row.name,
      version: row.version,
      score: row.overall_score,
      security: row.security_score,
      compliance: row.compliance_score,
      reputation: row.vendor_reputation_score,
      evidenceCount: parseJson<any[]>(row.evidence, []).length,
      vulnerabilityCount: parseJson<any[]>(row.vulnerabilities, []).length,
    });
  });
  return router;
}
