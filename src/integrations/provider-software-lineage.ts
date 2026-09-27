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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SOFTWARE_OBSERVATION_NON_JSON_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  throw new Error('SOFTWARE_OBSERVATION_NOT_JSON_COMPATIBLE');
}

export function prepareSoftwareLineageObservation(input: ProviderSoftwareObservation) {
  const normalized = normalizeSoftware(input);
  const rawJson = canonicalJson(input.raw);
  return {
    ...normalized,
    identityAutoMatchAllowed: shouldAutoMatch(normalized),
    observationHash: createHash('sha256').update(rawJson).digest('hex'),
    // Product identity confidence is not deployment evidence. Passport
    // association remains null until explicit tenant-scoped evidence proves it.
    passportId: null as string | null,
  };
}
