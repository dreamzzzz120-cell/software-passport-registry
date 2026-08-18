import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.APP_URL;
  delete process.env.APP_ALLOWED_ORIGINS;
  delete process.env.DATABASE_URL;
  delete process.env.SQL_HOST;
  delete process.env.SQL_USER;
  delete process.env.SQL_PASSWORD;
  delete process.env.SQL_DB_NAME;
  delete process.env.REDIS_URL;
});

describe('SPR configuration smoke test', () => {
  it('loads the configuration in test mode without production credentials', async () => {
    const { config } = await import('../src/config.ts');
    expect(config.nodeEnv).toBe('test');
    expect(config.isProduction).toBe(false);
    expect(config.redis.failOpen).toBe(false);
  });
});
