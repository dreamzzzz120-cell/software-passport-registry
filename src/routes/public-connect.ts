import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';

function parseJson(value: unknown, fallback: unknown[] = []) {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function createPublicConnectRouter() {
  const router = Router();
  router.get('/public/v1/passports/:id/trust', async (req, res) => {
    const result = await db.execute(sql`
      SELECT id, name, version, overall_score, security_score, compliance_score, vendor_reputation_score, evidence, vulnerabilities
      FROM passports WHERE id = ${req.params.id} LIMIT 1
    `);
    const row = (result as any).rows?.[0] as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'Passport not found' });
    res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    return res.json({
      passportId: row.id,
      name: row.name,
      version: row.version,
      score: row.overall_score,
      security: row.security_score,
      compliance: row.compliance_score,
      reputation: row.vendor_reputation_score,
      evidenceCount: parseJson(row.evidence).length,
      vulnerabilityCount: parseJson(row.vulnerabilities).length,
    });
  });
  return router;
}
