import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Founder passport registry scope contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/routes/founder-command-center.ts'), 'utf8');

  it('excludes the Free Review system tenant from the customer registry', () => {
    expect(source).toContain("WHERE p.tenant_id <> 'tenant-free-review-system'");
  });

  it('deduplicates repeated scans to the newest passport per tenant, publisher, and software name', () => {
    expect(source).toContain('ROW_NUMBER() OVER');
    expect(source).toContain('PARTITION BY p.tenant_id, LOWER(p.name), LOWER(p.publisher)');
    expect(source).toContain('WHERE ranked.rn = 1');
  });

  it('exposes historical version count without deleting historical passport rows', () => {
    expect(source).toContain('COUNT(*) OVER (PARTITION BY tenant_id, LOWER(name), LOWER(publisher)) AS version_count');
    expect(source).toContain('p.version_count AS "versionCount"');
  });
});
