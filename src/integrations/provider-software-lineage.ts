/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { normalizeSoftware, shouldAutoMatch, type SoftwareObservation } from './software-normalization.ts';

export type ProviderSoftwareObservation = SoftwareObservation & {
  provider: string;
  providerCustomerId: string;
  clientId?: string | null;
  externalDeviceId: string;
  externalSoftwareId?: string | null;
  sourceObservedAt: string;
  raw: unknown;
};

export function prepareSoftwareLineageObservation(input: ProviderSoftwareObservation) {
  const normalized = normalizeSoftware(input);
  const rawJson = JSON.stringify(input.raw);
  return {
    ...normalized,
    autoMatchAllowed: shouldAutoMatch(normalized),
    observationHash: createHash('sha256').update(rawJson).digest('hex'),
    // A normalized product name is not proof that a particular passport was
    // deployed. Passport association remains null until an explicit,
    // tenant-scoped mapping/evidence rule establishes it.
    passportId: null as string | null,
  };
}
