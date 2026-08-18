export function createSharedRateLimitStoreFromEnv(): RateLimitStore {
  // Production must use the shared Redis limiter; never silently fall back to process-local state.
  if (!config.isProduction) return new InMemoryStore();
  if (!config.redis.url) throw new Error('REDIS_URL is required for production rate limiting');
  IORedis ??= loadIoredis();
  if (!IORedis) throw new Error('ioredis is required for production rate limiting');
  const client = new IORedis(config.redis.url, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    commandTimeout: 5000,
    retryStrategy: (times: number) => Math.min(times * 250, 2000),
  });
  client.on('error', (err: Error) => console.error('[RateLimiter] Redis error:', err.message));
  client.on('ready', () => console.info('[RateLimiter] Redis ready'));
  client.on('end', () => console.error('[RateLimiter] Redis connection ended; requests will fail closed'));
  void client.connect().catch((err: Error) => console.error('[RateLimiter] Redis initial connection failed:', err.message));
  return new RedisStore(createAtomicRateLimitClient('ioredis', client));
}

if (config.isProduction) sharedStore = createSharedRateLimitStoreFromEnv();
