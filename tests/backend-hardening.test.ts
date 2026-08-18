import { describe, expect, it } from 'vitest';
import { RedisStore } from '../src/middleware/security.ts';

describe('backend hardening', () => {
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
