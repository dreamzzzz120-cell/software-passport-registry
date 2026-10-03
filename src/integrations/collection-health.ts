import type { ControlObservation } from '../trust/trust-loop.ts';

export type CollectionHealth = {
  status: 'SUCCEEDED' | 'PARTIAL';
  monitoringStatus: 'HEALTHY' | 'DEGRADED';
  credentialStatus: 'LIVE' | 'ERROR';
  unknownCount: number;
  knownCount: number;
};

/** Collection completion is distinct from coverage: an UNKNOWN observation is
 * persisted as evidence of a gap, never interpreted as a passing control. */
export function summarizeCollectionHealth(observations: readonly Pick<ControlObservation, 'status'>[]): CollectionHealth {
  const unknownCount = observations.filter((observation) => observation.status === 'UNKNOWN').length;
  const knownCount = observations.length - unknownCount;
  const complete = observations.length > 0 && unknownCount === 0;
  return {
    status: complete ? 'SUCCEEDED' : 'PARTIAL',
    monitoringStatus: complete ? 'HEALTHY' : 'DEGRADED',
    credentialStatus: complete ? 'LIVE' : 'ERROR',
    unknownCount,
    knownCount,
  };
}
