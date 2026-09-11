/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Builds every report type for every passport in the founder tenant whose
 * repository scan has completed, through buildAndPersistReport -- the single
 * builder the dashboard and the Connect API use -- so the snapshots persist to
 * trust_report_snapshots (visible under Reports) and an identical JSON copy is
 * written to stdout between BEGIN_REPORTS / END_REPORTS markers for rendering.
 *
 * Run inside the app container:
 *   railway ssh --service spr-app-staging -- node dist/generate-founder-reports.cjs
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { appPool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { buildAndPersistReport } from '../src/routes/trust-loop.ts';
import { toPlainEnglish } from '../src/trust/plain-english-report.ts';

const TYPES = ['executive', 'technical', 'msp', 'customer', 'compliance', 'vendor', 'auditor', 'evidence-ledger'] as const;

async function main() {
  const founderEmail = (process.env.FOUNDER_EMAILS || process.env.SPR_INITIAL_OWNER_EMAIL || '').split(',')[0].trim().toLowerCase();
  if (!founderEmail) throw new Error('FOUNDER_EMAILS / SPR_INITIAL_OWNER_EMAIL not set');
  const client = await appPool.connect();
  const out: Record<string, any> = { generatedAt: new Date().toISOString(), passports: [] as any[] };
  try {
    const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);
    const user = tenantArg ? { tenant_id: tenantArg } : (await client.query('SELECT tenant_id FROM users WHERE lower(btrim(email)) = $1 ORDER BY created_at ASC LIMIT 1', [founderEmail])).rows[0];
    if (!user) throw new Error(`no user row for ${founderEmail}; pass --tenant=<tenant id>`);
    const tenantId: string = user.tenant_id;
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db = drizzle(client, { schema });
    const passports = (await db.execute(sql`
      SELECT DISTINCT p.id, p.name, p.version, p.publisher
      FROM passports p JOIN agent_jobs j ON j.passport_id = p.id AND j.tenant_id = p.tenant_id
      WHERE p.tenant_id = ${tenantId} AND j.job_type = 'repository_scan' AND j.status = 'Completed'
      ORDER BY p.name
    `) as any).rows ?? [];
    for (const passport of passports) {
      const reports: Record<string, unknown> = {};
      for (const type of TYPES) {
        const report = await buildAndPersistReport(db, tenantId, passport.id, type);
        if (report) reports[type] = report;
      }
      const executive = reports.executive as any;
      const plainEnglish = executive ? toPlainEnglish(executive) : null;
      out.passports.push({ id: passport.id, name: passport.name, version: passport.version, publisher: passport.publisher, reports, plainEnglish });
      console.error(`built ${Object.keys(reports).length} reports for ${passport.name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await appPool.end().catch(() => undefined);
  }
  console.log('BEGIN_REPORTS');
  console.log(JSON.stringify(out));
  console.log('END_REPORTS');
}

main().catch((error) => { console.error(error); process.exit(1); });
