import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('intake database tenant boundary', () => {
  it('isolates claimed rows and hides anonymous rows from runtime tenants', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE spr_app_runtime NOBYPASSRLS;
        CREATE ROLE spr_worker_runtime NOBYPASSRLS;
        CREATE TABLE intake_sessions (id text PRIMARY KEY, tenant_id text);
        CREATE TABLE intake_items (id text PRIMARY KEY, tenant_id text);
        CREATE TABLE free_review_submissions (id text PRIMARY KEY, tenant_id text);
        INSERT INTO intake_sessions VALUES ('a','tenant-a'),('b','tenant-b'),('anonymous',NULL);
        INSERT INTO intake_items VALUES ('a','tenant-a'),('b','tenant-b'),('anonymous',NULL);`);
      await db.exec(await readFile(new URL('../migrations/0056_intake_tenant_rls.sql', import.meta.url), 'utf8'));
      for (const role of ['spr_app_runtime', 'spr_worker_runtime']) {
        await db.exec(`SET ROLE ${role}; SET app.tenant_id = 'tenant-a';`);
        for (const table of ['intake_sessions', 'intake_items']) {
          expect((await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows).toEqual([{ id: 'a' }]);
          expect((await db.query(`UPDATE ${table} SET tenant_id='tenant-a' WHERE id='b' RETURNING id`)).rows).toEqual([]);
          await expect(db.exec(`INSERT INTO ${table} VALUES ('forged','tenant-b')`)).rejects.toThrow(/row-level security/i);
        }
        await db.exec(`SET app.tenant_id = 'tenant-b';`);
        expect((await db.query('SELECT id FROM intake_sessions')).rows).toEqual([{ id: 'b' }]);
        await db.exec('RESET ROLE;');
      }
    } finally { await db.close(); }
  });
});
