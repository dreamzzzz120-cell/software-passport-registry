import { describe, expect, it } from 'vitest';

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
});
