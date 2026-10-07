import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Founder Free Review funnel tenant truthfulness', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/server/founder/overview.ts'), 'utf8');

  it('reads Free Review completions, failures, and leads from the Free Review system tenant', () => {
    expect(source).toContain("import { FREE_REVIEW_TENANT_ID } from '../../../routes/free-review-submit.ts';");
    expect(source).toContain("tenant_id=${FREE_REVIEW_TENANT_ID} AND job_type='repository_scan' AND status='Completed'");
    expect(source).toContain("tenant_id=${FREE_REVIEW_TENANT_ID} AND job_type='repository_scan' AND status='Failed'");
    expect(source).toContain('FROM free_review_leads WHERE tenant_id=${FREE_REVIEW_TENANT_ID}');
  });

  it('does not count distribution-tenant repository scans as Free Review funnel outcomes', () => {
    const funnelStart = source.indexOf('export async function founderFunnel');
    const funnel = source.slice(funnelStart, source.indexOf('export async function founderOverview', funnelStart));
    expect(funnel).not.toContain("tenant_id=${DISTRIBUTION_TENANT_ID} AND job_type='repository_scan'");
    expect(funnel).not.toContain('FROM free_review_leads WHERE tenant_id=${DISTRIBUTION_TENANT_ID}');
  });
});
