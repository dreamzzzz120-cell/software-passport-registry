import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { clientInventoryQuery } from '../src/lib/clientInventoryQuery.ts';
let pg: PGlite;
const dialect = new PgDialect();
async function read(scope: string | null = null) {
  const q = dialect.sqlToQuery(clientInventoryQuery('t1', scope));
  return (await pg.query<any>(q.sql, q.params)).rows;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE clients (id text,tenant_id text,name text,domain text,industry text,trust_score int,risk_level text,avatar_color text,subscription_tier text,joined_date text,team_count int,passport_count int,critical_risks_count int,compliance_progress int,software_inventory text,compliance_status text,team_members text,activity_timeline text);
    CREATE TABLE passports (id text,tenant_id text,client_id text,name text,version text,verification_status text,overall_score int);
    CREATE TABLE scan_findings (id text,tenant_id text,asset_id text,severity text,status text);
    CREATE TABLE agent_jobs (tenant_id text,passport_id text,job_type text,status text,updated_at timestamptz);
    INSERT INTO clients(id,tenant_id,name,joined_date,passport_count,software_inventory) VALUES ('c1','t1','SPR','2026-10-05',99,'[]'),('c2','t1','Empty','2026-10-04',99,'[]'),('c1','t2','Other tenant','2026-10-05',99,'[]');
    INSERT INTO passports VALUES ('p1','t1','c1','SPR','abc','partial',91),('p2','t1','c1','Express','def','unverified',NULL),('p3','t1',NULL,'Unassigned','x','unverified',NULL),('p4','t2','c1','Private','x','verified',100);
    INSERT INTO scan_findings VALUES ('f1','t1','p2','HIGH','Open'),('f2','t1','p1','critical','Resolved'),('f3','t2','p1','critical','Open');
    INSERT INTO agent_jobs VALUES ('t1','p2','repository_scan','Completed','2026-10-05T19:14:00Z'),('t2','p1','repository_scan','Completed','2026-10-06T00:00:00Z');
  `);
});
afterAll(async () => { await pg.close(); });
describe('client inventory follows canonical assignments', () => {
  it('ignores stale cache counts, unassigned software and foreign tenant records', async () => {
    const rows = await read();
    expect(rows).toHaveLength(2);
    const c = rows.find(r => r.id === 'c1');
    expect(c.passportCount).toBe(2);
    expect(c.criticalRisksCount).toBe(1);
    expect(c.softwareInventory.map((p: any) => p.passportId).sort()).toEqual(['p1','p2']);
    expect(c.softwareInventory.every((p: any) => p.overallScore === null)).toBe(true);
    expect(c.softwareInventory.find((p: any) => p.passportId === 'p1').lastScanDate).toBeNull();
    expect(rows.find(r => r.id === 'c2').softwareInventory).toEqual([]);
  });
  it('honors Client-role scope and immediately follows reassignment', async () => {
    expect(await read('missing')).toEqual([]);
    expect((await read('c2'))[0].passportCount).toBe(0);
    await pg.exec("UPDATE passports SET client_id='c2' WHERE tenant_id='t1' AND id='p2'");
    expect((await read('c1'))[0].passportCount).toBe(1);
    const c = (await read('c2'))[0];
    expect(c.passportCount).toBe(1);
    expect(c.criticalRisksCount).toBe(1);
    expect(c.softwareInventory[0].riskStatus).toBe('Critical');
  });
});
