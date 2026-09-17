import { describe, expect, it } from 'vitest';
import { canRelateComponentToVulnerability, explicitComponentReference, persistedIdentity } from './trustGraphSecurity';

describe('Trust Graph relationship hardening', () => {
  it('accepts only non-empty persisted scalar identities', () => {
    expect(persistedIdentity('component-123')).toBe('component-123');
    expect(persistedIdentity(42)).toBe('42');
    expect(persistedIdentity('')).toBeNull();
    expect(persistedIdentity('   ')).toBeNull();
    expect(persistedIdentity({ id: 'component-123' })).toBeNull();
  });

  it('reads only explicit vulnerability component foreign keys', () => {
    expect(explicitComponentReference({ componentId: 'c-1', component: 'openssl' })).toBe('c-1');
    expect(explicitComponentReference({ component_id: 'c-2', component: 'openssl' })).toBe('c-2');
    expect(explicitComponentReference({ component: 'openssl' })).toBeNull();
  });

  it('never joins by component name', () => {
    expect(canRelateComponentToVulnerability(
      { id: 'c-1', name: 'openssl' },
      { component: 'openssl', componentId: 'c-2' },
    )).toBe(false);
  });

  it('allows a relationship only when persisted component identity matches', () => {
    expect(canRelateComponentToVulnerability(
      { id: 'c-1', name: 'openssl' },
      { component: 'openssl-3.0', componentId: 'c-1' },
    )).toBe(true);
  });

  it('does not create a relationship from PURL alone', () => {
    expect(canRelateComponentToVulnerability(
      { purl: 'pkg:npm/openssl@3.0.0', name: 'openssl' },
      { purl: 'pkg:npm/openssl@3.0.0', component: 'openssl' },
    )).toBe(false);
  });
});
