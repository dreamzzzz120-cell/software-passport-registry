import { describe, expect, it } from 'vitest';
import { credentialProviderFromParam, providerFromParam } from '../src/routes/integrations-live.ts';

// Regression coverage for the GitHub UI gap: PUT/DELETE .../credentials must
// accept github (credential storage is provider-agnostic), but POST .../test
// must keep rejecting it, because collectProviderEvidence expects a single
// observation shape that GitHub's deep collector (many ControlObservations)
// does not produce. Confusing the two would either silently break the
// generic /test route for github, or make credential storage impossible.
describe('provider gates', () => {
  it('credentialProviderFromParam accepts github', () => {
    expect(credentialProviderFromParam('github')).toBe('github');
  });

  it('credentialProviderFromParam accepts a known generic-adapter provider', () => {
    expect(credentialProviderFromParam('gitlab')).toBe('gitlab');
  });

  it('credentialProviderFromParam rejects an unknown provider', () => {
    expect(() => credentialProviderFromParam('not-a-real-provider')).toThrow('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER');
  });

  it('providerFromParam still rejects github for the generic single-observation adapter', () => {
    expect(() => providerFromParam('github')).toThrow('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER');
  });

  it('providerFromParam still accepts a known generic-adapter provider', () => {
    expect(providerFromParam('gitlab')).toBe('gitlab');
  });
});
