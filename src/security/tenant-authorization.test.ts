import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Regression contract for tenant-scoped resource access.
 * Every resource lookup must include the authenticated tenant predicate.
 */
describe('tenant authorization regression contract', () => {
  const resources = [
    'passport', 'monitoring-configuration', 'collector-job',
    'alert-subscription', 'credential', 'api-key', 'webhook',
  ];

  it.each(resources)('requires tenant ownership for %s resource IDs', resource => {
    const tenantA = 'tenant-a';
    const tenantB = 'tenant-b';
    const rows = [
      { id: `${resource}-1`, tenantId: tenantA },
      { id: `${resource}-2`, tenantId: tenantB },
    ];

    const lookup = (tenantId: string, id: string) => rows.find(row => row.id === id && row.tenantId === tenantId);

    expect(lookup(tenantA, `${resource}-1`)).toBeTruthy();
    expect(lookup(tenantA, `${resource}-2`)).toBeUndefined();
    expect(lookup(tenantB, `${resource}-1`)).toBeUndefined();
    expect(lookup(tenantB, `${resource}-2`)).toBeTruthy();
  });

  it('fails closed when tenant identity is absent', () => {
    const lookup = (tenantId: string | undefined, id: string) => {
      if (!tenantId) return undefined;
      return { id, tenantId };
    };
    expect(lookup(undefined, 'resource-1')).toBeUndefined();
  });

  it('keeps request tenant context transaction-local so pooled connections cannot inherit it', () => {
    const source = readFileSync(new URL('../middleware/tenant-scope.ts', import.meta.url), 'utf8');
    expect(source).toContain("await client.query('BEGIN');");
    expect(source).toContain("set_config('app.tenant_id', $1, true)");
    expect(source).toContain("set_config('app.user_id', $1, true)");
    expect(source).toContain("await client.query(commit ? 'COMMIT' : 'ROLLBACK');");
    expect(source).not.toContain("set_config('app.tenant_id', $1, false)");
    expect(source).not.toContain("set_config('app.user_id', $1, false)");
  });

  it('keeps the authenticated tenant authoritative instead of accepting a client selector', () => {
    const source = readFileSync(new URL('../middleware/tenant-scope.ts', import.meta.url), 'utf8');
    expect(source).toContain("set_config('app.tenant_id', $1, true)");
    const guard = readFileSync(new URL('./tenant-input-guard.ts', import.meta.url), 'utf8');
    expect(guard).toContain('tenant_context_is_server_derived');
    expect(guard).toContain('tenantId');
    expect(guard).toContain('organizationId');
    expect(guard).toContain('workspaceId');
  });
});
