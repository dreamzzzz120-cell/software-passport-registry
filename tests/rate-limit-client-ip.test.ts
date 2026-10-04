import { describe, expect, it } from 'vitest';
import { selectLimiterIp } from '../src/middleware/security.ts';

describe('production rate-limit client IP selection', () => {
  it('prefers a valid Railway X-Real-IP when the Railway header is trusted', () => {
    expect(selectLimiterIp({
      railwayRealIp: '145.132.103.67',
      expressIp: '10.0.0.12',
      socketIp: '10.0.0.13',
    }, true)).toBe('145.132.103.67');
  });

  it('rejects malformed Railway IP values and falls back to Express identity', () => {
    expect(selectLimiterIp({
      railwayRealIp: '145.132.103.67, 10.0.0.1',
      expressIp: '10.0.0.12',
      socketIp: '10.0.0.13',
    }, true)).toBe('10.0.0.12');
  });

  it('does not trust Railway-specific headers outside production', () => {
    expect(selectLimiterIp({
      railwayRealIp: '145.132.103.67',
      expressIp: '127.0.0.1',
      socketIp: '127.0.0.1',
    }, false)).toBe('127.0.0.1');
  });

  it('falls back to socket identity, then unknown', () => {
    expect(selectLimiterIp({ socketIp: '::1' }, true)).toBe('::1');
    expect(selectLimiterIp({}, true)).toBe('unknown');
  });
});
