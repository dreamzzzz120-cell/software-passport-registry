import { describe, expect, it } from 'vitest';
import { backoffMs, isRetryableStatus, retryAfterMs, withConnectorRetry } from './resilience.ts';
import { blockPrivateAddress } from './adapters.ts';
import { normalizeSoftware, shouldAutoMatch } from './software-normalization.ts';
import { buildExecutiveSummary } from '../reports/executive-summary.ts';

describe('connector resilience', () => {
  it('retries transient provider failures and eventually succeeds', async () => {
    let calls = 0;
    const result = await withConnectorRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('PROVIDER_HTTP_503');
      return 'ok';
    }, { sleep: async () => undefined, random: () => 0 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
  it('does not retry permanent failures', async () => {
    let calls = 0;
    await expect(withConnectorRetry(async () => { calls++; throw new Error('PROVIDER_HTTP_401'); }, { sleep: async () => undefined })).rejects.toThrow('PROVIDER_HTTP_401');
    expect(calls).toBe(1);
  });
  it('recognizes rate limits and server failures', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(backoffMs(1, undefined, 0)).toBe(188);
  });
  it('parses Retry-After safely and caps provider-directed delays', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('999999')).toBe(8000);
    expect(retryAfterMs('not-a-delay')).toBeUndefined();
  });
});

describe('outbound SSRF protection', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '198.18.0.1', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254',
  ])('blocks non-public address %s', (address) => {
    expect(blockPrivateAddress(address)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('allows public address %s', (address) => {
    expect(blockPrivateAddress(address)).toBe(false);
  });
});

describe('software normalization', () => {
  it('maps common Microsoft 365 aliases without relying on raw string equality', () => {
    const result = normalizeSoftware({ name: 'M365 Pro', publisher: 'Microsoft Corporation', version: '16.0' });
    expect(result.canonicalName).toBe('Microsoft 365');
    expect(result.disposition).toBe('matched');
    expect(shouldAutoMatch(result)).toBe(true);
  });
  it('sends ambiguous records to review instead of inventing a risky identity', () => {
    const result = normalizeSoftware({ name: 'Unknown Business App' });
    expect(result.disposition).toBe('unknown');
    expect(shouldAutoMatch(result)).toBe(false);
  });
});

describe('executive summary', () => {
  it('turns technical findings into prioritized business actions', () => {
    const summary = buildExecutiveSummary([{ title: 'Outdated application', severity: 'high', businessImpact: 'Security exposure', recommendedAction: 'Upgrade and verify the application.' }]);
    expect(summary.priority).toBe('high');
    expect(summary.headline).toContain('HIGH');
    expect(summary.nextSteps[0]).toContain('Upgrade');
  });
});
