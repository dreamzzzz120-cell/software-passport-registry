import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('expired anonymous intake retention boundary', () => {
  it('only selects expired OPEN anonymous sessions and only purges pre-claim item states', async () => {
    const source = await readFile(path.resolve('src/workers/retention-worker.ts'), 'utf8');
    expect(source).toContain("tenant_id IS NULL AND status='OPEN' AND expires_at < CURRENT_TIMESTAMP");
    expect(source).toContain("status IN ('AWAITING_UPLOAD','UPLOADED')");
    expect(source).not.toMatch(/status IN \([^)]*QUEUED[^)]*\)/);
    expect(source).not.toMatch(/status IN \([^)]*PROCESSING[^)]*\)/);
    expect(source).not.toMatch(/status IN \([^)]*COMPLETED[^)]*\)/);
  });

  it('deletes storage before marking database rows PURGED/EXPIRED', async () => {
    const source = await readFile(path.resolve('src/workers/retention-worker.ts'), 'utf8');
    const removeAt = source.indexOf('.remove([item.storage_path])');
    const purgedAt = source.indexOf("SET status='PURGED'");
    const expiredAt = source.indexOf("SET status='EXPIRED'");
    expect(removeAt).toBeGreaterThan(0);
    expect(purgedAt).toBeGreaterThan(removeAt);
    expect(expiredAt).toBeGreaterThan(purgedAt);
    expect(source).toContain('if (removed.error) throw new Error');
  });

  it('worker-only RLS policy is restricted to expired anonymous OPEN sessions', async () => {
    const migration = await readFile(path.resolve('migrations/0124_expired_intake_worker_cleanup.sql'), 'utf8');
    expect(migration).toContain("TO spr_worker_runtime");
    expect(migration).toContain("tenant_id IS NULL AND status='OPEN' AND expires_at < CURRENT_TIMESTAMP");
    expect(migration).not.toContain('TO spr_app_runtime');
    expect(migration).not.toContain('BYPASSRLS');
  });
});
