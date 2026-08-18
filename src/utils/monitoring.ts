import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export type CollectorStatus = 'succeeded' | 'failed' | 'timed_out' | 'unavailable' | 'unsupported';
export type JobState = 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'dead_lettered';
export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'expired' | 'unknown';

export interface CollectorDefinition {
  id: string;
  type: string;
  version: string;
  supportedSubjectTypes: string[];
  defaultSchedule: string;
  minimumScheduleSeconds: number;
  timeoutSeconds: number;
  maximumRetries: number;
  freshnessPolicyId: string;
  confidencePolicyId: string;
}

export interface FreshnessPolicy {
  id: string;
  version: string;
  agingAfterSeconds: number;
  staleAfterSeconds: number;
  expiresAfterSeconds: number;
}

export interface ConfidencePolicy {
  id: string;
  version: string;
  initialConfidence: number;
  agingStartSeconds: number;
  staleAfterSeconds: number;
  expiresAfterSeconds: number;
  minimumScoreEligibleConfidence: number;
}

export const COLLECTORS: Readonly<Record<string, CollectorDefinition>> = Object.freeze({
  repository: {
    id: 'repository', type: 'repository', version: 'spr.repository.v1',
    supportedSubjectTypes: ['github_repository'], defaultSchedule: 'PT6H',
    minimumScheduleSeconds: 900, timeoutSeconds: 30, maximumRetries: 3,
    freshnessPolicyId: 'repository.v1', confidencePolicyId: 'observed.v1',
  },
  dependency: {
    id: 'dependency', type: 'dependency', version: 'spr.dependency.v1',
    supportedSubjectTypes: ['github_repository'], defaultSchedule: 'PT6H',
    minimumScheduleSeconds: 900, timeoutSeconds: 120, maximumRetries: 3,
    freshnessPolicyId: 'dependency.v1', confidencePolicyId: 'observed.v1',
  },
  tls: {
    id: 'tls', type: 'tls', version: 'spr.tls.v1',
    supportedSubjectTypes: ['hostname'], defaultSchedule: 'PT1H',
    minimumScheduleSeconds: 900, timeoutSeconds: 15, maximumRetries: 2,
    freshnessPolicyId: 'network.v1', confidencePolicyId: 'observed.v1',
  },
  domain_dns: {
    id: 'domain_dns', type: 'domain_dns', version: 'spr.domain-dns.v1',
    supportedSubjectTypes: ['domain'], defaultSchedule: 'PT6H',
    minimumScheduleSeconds: 1800, timeoutSeconds: 15, maximumRetries: 2,
    freshnessPolicyId: 'domain.v1', confidencePolicyId: 'observed.v1',
  },
  uptime: {
    id: 'uptime', type: 'uptime', version: 'spr.uptime.v1',
    supportedSubjectTypes: ['url'], defaultSchedule: 'PT15M',
    minimumScheduleSeconds: 900, timeoutSeconds: 15, maximumRetries: 2,
    freshnessPolicyId: 'network.v1', confidencePolicyId: 'observed.v1',
  },
  release: {
    id: 'release', type: 'release', version: 'spr.release.v1',
    supportedSubjectTypes: ['github_repository'], defaultSchedule: 'PT6H',
    minimumScheduleSeconds: 900, timeoutSeconds: 30, maximumRetries: 3,
    freshnessPolicyId: 'repository.v1', confidencePolicyId: 'observed.v1',
  },
});

export const FRESHNESS_POLICIES: Readonly<Record<string, FreshnessPolicy>> = Object.freeze({
  'repository.v1': { id: 'repository.v1', version: '1', agingAfterSeconds: 21_600, staleAfterSeconds: 86_400, expiresAfterSeconds: 259_200 },
  'dependency.v1': { id: 'dependency.v1', version: '1', agingAfterSeconds: 21_600, staleAfterSeconds: 86_400, expiresAfterSeconds: 259_200 },
  'network.v1': { id: 'network.v1', version: '1', agingAfterSeconds: 3_600, staleAfterSeconds: 7_200, expiresAfterSeconds: 21_600 },
  'domain.v1': { id: 'domain.v1', version: '1', agingAfterSeconds: 21_600, staleAfterSeconds: 86_400, expiresAfterSeconds: 259_200 },
});

export const CONFIDENCE_POLICY: ConfidencePolicy = Object.freeze({
  id: 'observed.v1', version: '1', initialConfidence: 100,
  agingStartSeconds: 3_600, staleAfterSeconds: 86_400,
  expiresAfterSeconds: 259_200, minimumScoreEligibleConfidence: 50,
});

export function freshnessAt(collectedAt: string | null, now: Date, policy: FreshnessPolicy): FreshnessState {
  if (!collectedAt) return 'unknown';
  const age = Math.max(0, (now.getTime() - new Date(collectedAt).getTime()) / 1000);
  if (!Number.isFinite(age)) return 'unknown';
  if (age >= policy.expiresAfterSeconds) return 'expired';
  if (age >= policy.staleAfterSeconds) return 'stale';
  if (age >= policy.agingAfterSeconds) return 'aging';
  return 'fresh';
}

export function confidenceAt(collectedAt: string | null, now: Date, policy = CONFIDENCE_POLICY) {
  if (!collectedAt) return { confidence: 0, scoreEligible: false };
  const age = Math.max(0, (now.getTime() - new Date(collectedAt).getTime()) / 1000);
  if (!Number.isFinite(age) || age >= policy.expiresAfterSeconds) return { confidence: 0, scoreEligible: false };
  if (age <= policy.agingStartSeconds) return { confidence: policy.initialConfidence, scoreEligible: true };
  const span = policy.expiresAfterSeconds - policy.agingStartSeconds;
  const confidence = Math.max(0, Math.round(policy.initialConfidence * (1 - (age - policy.agingStartSeconds) / span)));
  return { confidence, scoreEligible: confidence >= policy.minimumScoreEligibleConfidence };
}

export function observationWindow(now: Date, scheduleSeconds: number) {
  return String(Math.floor(now.getTime() / 1000 / scheduleSeconds));
}

export function collectorJobKey(input: {
  tenantId: string; assetId: string; collectorId: string; subjectIdentifier: string;
  monitoredVersion: string; observationWindow: string; collectorVersion: string;
}) {
  const canonical = [
    input.tenantId, input.assetId, input.collectorId, input.subjectIdentifier,
    input.monitoredVersion, input.observationWindow, input.collectorVersion,
  ].join('\u001f');
  return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

export function advanceSchedule(previousDue: Date, now: Date, scheduleSeconds: number) {
  if (!Number.isInteger(scheduleSeconds) || scheduleSeconds < 1) throw new Error('INVALID_SCHEDULE');
  const interval = scheduleSeconds * 1000;
  const elapsed = Math.max(0, now.getTime() - previousDue.getTime());
  return new Date(previousDue.getTime() + (Math.floor(elapsed / interval) + 1) * interval);
}

export function failureResult(input: {
  status: Exclude<CollectorStatus, 'succeeded' | 'unsupported'>;
  safeErrorCode: string; safeErrorMessage?: string;
}) {
  return {
    status: input.status,
    state: 'unavailable' as const,
    score: null,
    evidence: [],
    findings: [],
    safeErrorCode: input.safeErrorCode,
    safeErrorMessage: input.safeErrorMessage ||
      'The collector did not produce a reliable observation. SPR does not treat this result as a pass or failure.',
  };
}

export function nextFailureState(attemptNumber: number, maximumAttempts: number): JobState {
  return attemptNumber >= maximumAttempts ? 'dead_lettered' : 'failed';
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

export function isBlockedIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') ||
      normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:169.254.') || normalized.startsWith('::ffff:192.168.');
  }
  return true;
}

export async function assertPublicNetworkTarget(rawUrl: string, resolver = dns.lookup) {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error('TARGET_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('TARGET_PROTOCOL_BLOCKED');
  if (target.username || target.password) throw new Error('TARGET_CREDENTIALS_BLOCKED');
  const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('TARGET_HOST_BLOCKED');
  }
  const results = await resolver(hostname, { all: true, verbatim: true });
  if (results.length === 0 || results.some(result => isBlockedIp(result.address))) {
    throw new Error('TARGET_NETWORK_BLOCKED');
  }
  return { url: target, addresses: results.map(result => result.address) };
}

export async function safeNetworkFetch(rawUrl: string, options: {
  timeoutMs?: number; maxRedirects?: number; maxBytes?: number;
  expectedContentTypes?: string[]; resolver?: typeof dns.lookup;
} = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 1_048_576;
  let current = rawUrl;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicNetworkTarget(current, options.resolver);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === maxRedirects) throw new Error('REDIRECT_LIMIT_EXCEEDED');
      current = new URL(location, current).toString();
      continue;
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim() || '';
    if (options.expectedContentTypes?.length && !options.expectedContentTypes.includes(contentType)) {
      throw new Error('UNSUPPORTED_CONTENT_TYPE');
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
    return { response, body: Buffer.concat(chunks).toString('utf8'), finalUrl: current };
  }
  throw new Error('REDIRECT_LIMIT_EXCEEDED');
}
