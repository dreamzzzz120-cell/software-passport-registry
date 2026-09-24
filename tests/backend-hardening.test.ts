import { describe, expect, it } from 'vitest';
import { RedisStore, rateLimiter, setRateLimiterStore } from '../src/middleware/security.ts';

describe('backend hardening', () => {
  it('limits one IP even when callers rotate authorization headers concurrently', async () => {
    const counts = new Map<string, number>();
    setRateLimiterStore({
      async incr(key: string) {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { count, resetAt: Date.now() + 60_000 };
      },
    });
    const statuses = await Promise.all(Array.from({ length: 45 }, (_, n) => new Promise<number>((resolve) => {
      const response: any = {
        statusCode: 200,
        setHeader() {},
        status(code: number) { this.statusCode = code; return this; },
        json() { resolve(this.statusCode); },
      };
      const request: any = { path: '/mutation', method: 'POST', ip: '192.0.2.9', headers: { authorization: `Bearer token-${n}` } };
      void rateLimiter(request, response, () => resolve(200));
    })));
    expect(statuses.filter((status) => status === 200)).toHaveLength(40);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });
  it('fails closed when Redis returns malformed rate-limit data', async () => {
    const store = new RedisStore({
      increment: async () => ['not-a-number', 1000],
    });
    await expect(store.incr('test', 60000, 100)).rejects.toThrow();
  });

  it('rejects malformed Redis TTL responses', async () => {
    const store = new RedisStore({
      increment: async () => [1, -1],
    });
    await expect(store.incr('test', 60000, 100)).rejects.toThrow();
  });
});
