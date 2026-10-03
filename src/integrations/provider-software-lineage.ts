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

const SECRET_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|token|access_token|refresh_token|api[_-]?key|secret|password|client_secret)$/i;

export function sanitizeSoftwareObservationRaw(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('SOFTWARE_OBSERVATION_MAX_DEPTH');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SOFTWARE_OBSERVATION_NON_JSON_NUMBER');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => sanitizeSoftwareObservationRaw(item, depth + 1));
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      clean[key] = SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeSoftwareObservationRaw(item, depth + 1);
    }
    return clean;
  }
  throw new Error('SOFTWARE_OBSERVATION_NOT_JSON_COMPATIBLE');
}

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
  const sourceObservedAt = new Date(input.sourceObservedAt);
  if (!Number.isFinite(sourceObservedAt.getTime())) throw new Error('SOFTWARE_OBSERVATION_INVALID_TIMESTAMP');
  if (sourceObservedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('SOFTWARE_OBSERVATION_FUTURE_TIMESTAMP');
  const sanitizedRaw = sanitizeSoftwareObservationRaw(input.raw);
  const rawJson = canonicalJson(sanitizedRaw);
  return {
    ...normalized,
    identityAutoMatchAllowed: shouldAutoMatch(normalized),
    sanitizedRaw,
    sourceObservedAt: sourceObservedAt.toISOString(),
    freshnessState: 'UNKNOWN' as const,
    observationHash: createHash('sha256').update(rawJson).digest('hex'),
    // Product identity confidence is not deployment evidence. Passport
    // association remains null until explicit tenant-scoped evidence proves it.
    passportId: null as string | null,
  };
}
