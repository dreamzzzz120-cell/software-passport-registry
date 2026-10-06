import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('upgrades the base table idempotently and preserves unknown historical creators', async () => {
  const pg = new PGlite();
  try {
    const base = readFileSync(new URL('../migrations/0000_base_application_schema.sql', import.meta.url), 'utf8');
    const table = base.match(/CREATE TABLE IF NOT EXISTS compliance_schedules \([\s\S]*?\);/)![0];
    await pg.exec(table);
    await pg.exec("INSERT INTO compliance_schedules(id,tenant_id,client_id,frequency,target_email,created_at) VALUES ('old','t1','c1','Weekly','owner@example.test','2026-10-01')");
    const migration = readFileSync(new URL('../migrations/0132_compliance_schedule_creator.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    await pg.query("INSERT INTO compliance_schedules (id,tenant_id,client_id,frequency,target_email,status,last_audit_at,next_audit_at,created_by,created_at) VALUES ($1,$2,$3,$4,$5,'Active',NULL,$6,$7,$8)", ['new','t1','c1','Weekly','owner@example.test','2026-10-12','owner@example.test','2026-10-05']);
    const rows = (await pg.query<any>('SELECT id,created_by FROM compliance_schedules ORDER BY id')).rows;
    expect(rows).toEqual([{id:'new',created_by:'owner@example.test'},{id:'old',created_by:null}]);
  } finally { await pg.close(); }
});
