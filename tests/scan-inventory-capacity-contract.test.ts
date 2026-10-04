import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('scan inventory capacity contract', () => {
  const retention = readFileSync(resolve(process.cwd(), 'src/workers/retention-worker.ts'), 'utf8');
  const migration = readFileSync(resolve(process.cwd(), 'migrations/0127_scan_inventory_capacity.sql'), 'utf8');

  it('expires anonymous Free Review inventory without deleting durable scan evidence', () => {
    expect(retention).toContain("FREE_REVIEW_TENANT_ID = 'tenant-free-review-system'");
    expect(retention).toContain('FREE_REVIEW_INVENTORY_RETENTION_HOURS');
    expect(retention).toContain('DELETE FROM scan_file_inventory');
    expect(retention).not.toContain('DELETE FROM evidence_items');
    expect(retention).not.toContain('DELETE FROM scan_findings');
    expect(retention).not.toContain('DELETE FROM scans');
    expect(retention).not.toContain('DELETE FROM passports');
  });

  it('fails safe for tenant inventory when no retention policy exists', () => {
    expect(retention).toContain('FROM retention_policies r');
    expect(retention).toContain('r.tenant_id = i.tenant_id');
    expect(retention).not.toContain('COALESCE');
  });

  it('deletes in bounded batches and records capacity telemetry', () => {
    expect(retention).toContain('SCAN_FILE_INVENTORY_RETENTION_BATCH');
    expect(retention).toContain('LIMIT $3');
    expect(retention).toContain("pg_total_relation_size('public.scan_file_inventory')");
    expect(retention).toContain('pg_database_size(current_database())');
    expect(retention).toContain('[Retention] scan file inventory capacity');
  });

  it('removes the four oversized redundant indexes and keeps a retention index', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS public.idx_sfi_tenant_passport_path');
    expect(migration).toContain('DROP INDEX IF EXISTS public.idx_sfi_tenant_scan_path');
    expect(migration).toContain('DROP INDEX IF EXISTS public.idx_sfi_tenant_scan_sha');
    expect(migration).toContain('DROP INDEX IF EXISTS public.idx_sfi_tenant_scan_seq');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_sfi_updated_at');
    expect(migration).not.toContain('DROP INDEX IF EXISTS public.scan_file_inventory_pkey');
    expect(migration).not.toContain('DROP INDEX IF EXISTS public.scan_file_inventory_scan_id_sequence_key');
  });
});
