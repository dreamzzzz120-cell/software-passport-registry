import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join(process.cwd(), 'migrations');
const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const strip = (sql: string) => sql.replace(/--[^\n]*/g, '');
const bodies = files.map((name) => strip(fs.readFileSync(path.join(migrationsDir, name), 'utf8')));

// 0054 swept the catalog and hardened every table that carried tenant_id at the
// time, so anything created before it is covered by that backfill. Anything
// created AFTER it has to harden itself -- the sweep is a one-time backfill, not
// a standing rule, and it does not run again.
const SWEEP_INDEX = files.findIndex((name) => name.startsWith('0054_'));

interface CreatedTable { table: string; index: number; file: string }

const createdTenantTables: CreatedTable[] = bodies.flatMap((sql, index) =>
  [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi)]
    .filter((match) => /\btenant_id\b/.test(match[2]))
    .map((match) => ({ table: match[1].toLowerCase(), index, file: files[index] })));

/** Hardened if some migration at or after its creation names it beside RLS. */
function isHardenedAfterCreation({ table, index }: CreatedTable): boolean {
  return bodies.slice(index).some((sql) =>
    new RegExp(`\\b${table}\\b`).test(sql)
    && (/FORCE ROW LEVEL SECURITY/i.test(sql) || /spr_assert_tenant_rls\s*\(\s*\)/i.test(sql)));
}

// This has now happened three times. 0055 created the intake tables without RLS
// and 0056 was written to fix it. 0068 created psa_webhook_endpoints and
// psa_webhook_events without RLS, and spr_assert_tenant_rls() caught it the
// expensive way: /ready returned 503, the Railway healthcheck never passed, and
// five consecutive deploys failed while the live instance sat degraded. The
// runtime assertion is right to exist; it should just never be the thing that
// finds this first.
describe('a tenant table created after the 0054 sweep hardens itself', () => {
  const afterSweep = createdTenantTables.filter((entry) => entry.index > SWEEP_INDEX);

  it('knows where the sweep is', () => {
    expect(SWEEP_INDEX).toBeGreaterThan(0);
  });

  it('has row-level security for every tenant table added since', () => {
    const unhardened = afterSweep.filter((entry) => !isHardenedAfterCreation(entry));
    expect(
      unhardened.map((entry) => `${entry.table} (created in ${entry.file})`),
      'tenant tables created after the 0054 sweep with no ENABLE/FORCE row level security in that migration or any later one',
    ).toEqual([]);
  });

  it('keeps the runtime assertion in the schema as the last line of defence', () => {
    const all = bodies.join('\n');
    expect(all).toContain('CREATE OR REPLACE FUNCTION spr_assert_tenant_rls()');
    expect(all).toContain('TENANT_RLS_NOT_HARDENED');
  });

  it('hardens the PSA webhook tables specifically, since their rows carry per-tenant secrets', () => {
    const all = bodies.join('\n');
    for (const table of ['psa_webhook_endpoints', 'psa_webhook_events']) {
      expect(all, `${table} must be named in an RLS hardening block`).toMatch(new RegExp(`'${table}'`));
    }
    expect(all).toMatch(/FOREACH tbl IN ARRAY ARRAY\['psa_webhook_endpoints', 'psa_webhook_events'\]/);
  });
});

// The Production Release Gate rejects gaps, duplicates and out-of-order files.
// Deleting duplicate migrations 0062 and 0063 left holes, and every release run
// after that failed with "expected 0062, found 0064" -- a green test suite and a
// red release, for a reason no test could see.
describe('migration sequence matches what the release gate enforces', () => {
  const versions = files.map((name) => Number(name.slice(0, 4)));

  it('has no duplicate numbers', () => {
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('is contiguous from 0000', () => {
    expect(versions[0]).toBe(0);
    const missing: number[] = [];
    for (let i = 0; i <= versions[versions.length - 1]; i += 1) if (!versions.includes(i)) missing.push(i);
    expect(missing, `gaps in the migration sequence: ${missing.map((n) => String(n).padStart(4, '0')).join(', ')}`).toEqual([]);
  });

  it('names every file in the shape the gate accepts', () => {
    for (const name of files) expect(name, name).toMatch(/^[0-9]{4}_[a-zA-Z0-9_-]+\.sql$/);
  });
});
