import { describe, expect, it } from 'vitest';
import { componentIdentity, vulnerabilityIdentity } from '../src/security/osv-identity.ts';

describe('OSV stable identities', () => {
  it('does not create a second component identity for duplicate inventory entries', () => {
    const identities = new Set([
      componentIdentity({ ecosystem: 'npm', name: 'express', version: '4.18.2' }),
      componentIdentity({ ecosystem: 'NPM', name: ' Express ', version: '4.18.2' }),
    ]);
    expect(identities).toHaveLength(1);
  });
  it('deduplicates the same vulnerability across repeated scan jobs', () => {
    const input = { tenantId: 'tenant', passportId: 'passport', vulnerabilityId: 'GHSA-test', component: { name: 'express', version: '4.18.2', ecosystem: 'npm' } };
    expect(vulnerabilityIdentity(input)).toBe(vulnerabilityIdentity({ ...input }));
  });
  it('keeps different components distinct even for the same vulnerability id', () => {
    const base = { tenantId: 'tenant', passportId: 'passport', vulnerabilityId: 'GHSA-test' };
    expect(vulnerabilityIdentity({ ...base, component: { name: 'express', version: '4.18.2' } })).not.toBe(vulnerabilityIdentity({ ...base, component: { name: 'express', version: '5.0.0' } }));
  });
});
