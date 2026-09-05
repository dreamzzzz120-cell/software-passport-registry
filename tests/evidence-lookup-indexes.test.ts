import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'migrations/0061_evidence_finding_lookup_indexes.sql'), 'utf8');
const baseSchema = fs.readFileSync(path.join(root, 'migrations/0000_base_application_schema.sql'), 'utf8');
const authRoutes = fs.readFileSync(path.join(root, 'src/routes/auth.ts'), 'utf8');

describe('evidence/finding lookup indexes', () => {
  it('indexes the exact (tenant_id, asset_id) predicate the passport query uses', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS evidence_items_tenant_asset_idx');
    expect(migration).toContain('ON evidence_items (tenant_id, asset_id, timestamp DESC)');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS scan_findings_tenant_asset_idx');
    expect(migration).toContain('ON scan_findings (tenant_id, asset_id, detected_at DESC)');
  });

  it('indexes the worker job reconciliation lookup', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS scan_findings_job_idx');
    expect(migration).toContain('ON scan_findings (job_id, tenant_id)');
  });

  it('is transactional and idempotent, like every other migration here', () => {
    expect(migration.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    const statements = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).toContain('CREATE INDEX');
    expect(statements.match(/CREATE INDEX (?!IF NOT EXISTS)/)).toBeNull();
  });

  it('every indexed column actually exists on its table', () => {
    const table = (name: string) => {
      const start = baseSchema.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
      return baseSchema.slice(start, baseSchema.indexOf(');', start));
    };
    const evidence = table('evidence_items');
    for (const column of ['tenant_id', 'asset_id', 'timestamp']) expect(evidence).toContain(column);
    const findings = table('scan_findings');
    for (const column of ['tenant_id', 'asset_id', 'detected_at', 'job_id']) expect(findings).toContain(column);
  });

  it('the query these indexes serve still filters on the indexed columns', () => {
    expect(authRoutes).toContain('FROM evidence_items e WHERE e.tenant_id=p.tenant_id AND e.asset_id=p.id');
    expect(authRoutes).toContain('FROM scan_findings f WHERE f.tenant_id=p.tenant_id AND f.asset_id=p.id');
  });
});
