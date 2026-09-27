/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { prepareSoftwareLineageObservation } from './provider-software-lineage.ts';

describe('provider software lineage boundary', () => {
  it('never turns a normalized product name into a passport deployment link', () => {
    const result = prepareSoftwareLineageObservation({
      provider: 'ninjaone', providerCustomerId: 'cust-1', clientId: 'client-1',
      externalDeviceId: 'device-1', externalSoftwareId: 'software-1',
      name: 'Microsoft 365', publisher: 'Microsoft', version: '1.2.3',
      sourceObservedAt: '2026-09-27T00:00:00Z', raw: { id: 'software-1', name: 'Microsoft 365' },
    });
    expect(result.disposition).toBe('matched');
    expect(result.identityAutoMatchAllowed).toBe(true);
    expect(result.passportId).toBeNull();
  });

  it('keeps ambiguous software unknown instead of inventing identity', () => {
    const result = prepareSoftwareLineageObservation({
      provider: 'ninjaone', providerCustomerId: 'cust-1',
      externalDeviceId: 'device-1', name: 'Agent', sourceObservedAt: '2026-09-27T00:00:00Z',
      raw: { name: 'Agent' },
    });
    expect(result.disposition).toBe('unknown');
    expect(result.identityAutoMatchAllowed).toBe(false);
    expect(result.passportId).toBeNull();
  });

  it('hashes semantically identical JSON deterministically regardless of object key order', () => {
    const a = prepareSoftwareLineageObservation({ provider: 'ninjaone', providerCustomerId: 'c', externalDeviceId: 'd', name: 'Tool', sourceObservedAt: '2026-09-27T00:00:00Z', raw: { name: 'Tool', nested: { b: 2, a: 1 } } });
    const b = prepareSoftwareLineageObservation({ provider: 'ninjaone', providerCustomerId: 'c', externalDeviceId: 'd', name: 'Tool', sourceObservedAt: '2026-09-27T00:00:00Z', raw: { nested: { a: 1, b: 2 }, name: 'Tool' } });
    expect(a.observationHash).toBe(b.observationHash);
  });

  it('hashes materially different source observations differently', () => {
    const a = prepareSoftwareLineageObservation({ provider: 'ninjaone', providerCustomerId: 'c', externalDeviceId: 'd', name: 'Tool', sourceObservedAt: '2026-09-27T00:00:00Z', raw: { version: 1 } });
    const b = prepareSoftwareLineageObservation({ provider: 'ninjaone', providerCustomerId: 'c', externalDeviceId: 'd', name: 'Tool', sourceObservedAt: '2026-09-27T00:00:00Z', raw: { version: 2 } });
    expect(a.observationHash).not.toBe(b.observationHash);
  });
});
