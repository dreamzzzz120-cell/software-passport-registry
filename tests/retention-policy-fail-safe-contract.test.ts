import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('retention policy fail-safe contract', () => {
  it('must not treat a missing evidence policy as zero days', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/workers/retention-worker.ts'), 'utf8');
    expect(source).not.toContain('COALESCE((SELECT r.evidence_days');
    expect(source).toContain("EXISTS (SELECT 1 FROM retention_policies r WHERE r.tenant_id=o.tenant_id");
    expect(source).toContain('Missing retention policy means retain indefinitely');
  });
});
