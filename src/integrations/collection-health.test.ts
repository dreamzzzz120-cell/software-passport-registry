import { describe, expect, it } from 'vitest';
import { summarizeCollectionHealth } from './collection-health.ts';

describe('provider collection health', () => {
  it('marks a complete observation set live', () => {
    expect(summarizeCollectionHealth([{ status: 'PASS' }, { status: 'FAIL' }])).toEqual({
      status: 'SUCCEEDED', monitoringStatus: 'HEALTHY', credentialStatus: 'LIVE',
      unknownCount: 0, knownCount: 2,
    });
  });

  it('keeps partial and permission-limited evidence visible without claiming health', () => {
    expect(summarizeCollectionHealth([{ status: 'PASS' }, { status: 'UNKNOWN' }])).toEqual({
      status: 'PARTIAL', monitoringStatus: 'DEGRADED', credentialStatus: 'ERROR',
      unknownCount: 1, knownCount: 1,
    });
  });

  it('never promotes an all-unknown or empty collection', () => {
    for (const observations of [[{ status: 'UNKNOWN' }], []] as const) {
      const result = summarizeCollectionHealth(observations);
      expect(result.status).toBe('PARTIAL');
      expect(result.monitoringStatus).toBe('DEGRADED');
      expect(result.credentialStatus).toBe('ERROR');
    }
  });
});
