import { describe, expect, it } from 'vitest';
import { calculateBackoff, enqueueResearchUrl } from '../src/lib/distribution-engine.ts';

describe('distribution engine contracts', () => {
  it('uses bounded exponential backoff', () => {
    expect(calculateBackoff(1)).toBe(1000);
    expect(calculateBackoff(2)).toBe(2000);
    expect(calculateBackoff(10)).toBe(60000);
  });

  it('rejects non-http research targets before queueing', async () => {
    const pool = { query: async () => { throw new Error('queue should not be touched'); } } as any;
    await expect(enqueueResearchUrl(pool, 'file:///etc/passwd')).rejects.toThrow('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  });

  it('rejects loopback research targets before queueing', async () => {
    const pool = { query: async () => { throw new Error('queue should not be touched'); } } as any;
    await expect(enqueueResearchUrl(pool, 'http://127.0.0.1:8080/health')).rejects.toThrow('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  });
});
