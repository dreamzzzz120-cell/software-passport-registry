import { describe, expect, it } from 'vitest';
import { workspaceIdentity } from '../src/lib/workspaceIdentity';

describe('workspace identity validation', () => {
  const owner = { uid: 'user-a', tenantId: 'tenant-a', role: 'Owner', isFounder: true };
  it('preserves the confirmed owner role', () => {
    expect(workspaceIdentity(owner, 'user-a')).toEqual({ role: 'Owner', isFounder: true });
  });
  it.each([null, {}, { ...owner, role: undefined }, { ...owner, role: 'owner' }, { ...owner, uid: 'user-b' }, { ...owner, tenantId: '' }])('rejects an incomplete or mismatched profile instead of inventing Viewer: %j', profile => {
    expect(workspaceIdentity(profile, 'user-a')).toBeNull();
  });
  it('accepts Viewer only when explicitly confirmed', () => {
    expect(workspaceIdentity({ ...owner, role: 'Viewer', isFounder: 'true' }, 'user-a')).toEqual({ role: 'Viewer', isFounder: false });
  });
});
