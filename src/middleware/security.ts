/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { adminAuth } from '../lib/firebase-admin.ts';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export interface AuthenticatedRequest extends Request {
  user?: { id: number; uid: string; email: string; tenantId: string; role: string; emailVerified: boolean };
}

let rateLimitWindowMs = 60_000;
let maxRequestsPerWindow = 100;
const isTestMode = () => process.env.NODE_ENV !== 'production';

export function setRateLimiterConfig(opts: { windowMs?: number; maxRequests?: number }) {
  if (!isTestMode()) throw new Error('setRateLimiterConfig is only available in test mode');
  if (typeof opts.windowMs === 'number' && opts.windowMs > 0) rateLimitWindowMs = opts.windowMs;
  if (typeof opts.maxRequests === 'number' && opts.maxRequests > 0) maxRequestsPerWindow = Math.floor(opts.maxRequests);
}

interface RateLimitRecord { count: number; resetAt: number; }
interface RateLimitStore { incr(key: string, windowMs: number, limit: number): Promise<RateLimitRecord>; }

class InMemoryStore implements RateLimitStore {
  private map = new Map<string, RateLimitRecord>();
  async incr(key: string, windowMs: number) {
    const now = Date.now();
    const rec = this.map.get(key);
    if (!rec || now >= rec.resetAt) {
      const next = { count: 1, resetAt: now + windowMs };
      this.map.set(key, next);
      return next;
    }
    rec.count += 1;
    return rec;
  }
}

interface AtomicRateLimitClient { increment(script: string, key: string, windowMs: number, limit: number): Promise<unknown>; }
export class IORedisAtomicClient implements AtomicRateLimitClient {
  constructor(private readonly client: { eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> }) {}
  increment(script: string, key: string, windowMs: number, limit: number) { return this.client.eval(script, 1, key, String(windowMs), String(limit)); }
}

export function createAtomicRateLimitClient(provider: 'ioredis', client: any): AtomicRateLimitClient {
  if (provider === 'ioredis' && client && typeof client.eval === 'function') return new IORedisAtomicClient(client);
  throw new Error('Invalid or unsupported rate limit provider');
}

export class RedisStore implements RateLimitStore {
  private readonly lua = `local count = redis.call("INCR", KEYS[1])\nlocal ttl = redis.call("PTTL", KEYS[1])\nif count == 1 or ttl < 0 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) ttl = tonumber(ARGV[1]) end\nreturn {count, ttl}`;
  constructor(private readonly atomicClient: AtomicRateLimitClient) {}
  async incr(key: string, windowMs: number, limit: number) {
    const res = await this.atomicClient.increment(this.lua, key, windowMs, limit);
    if (!Array.isArray(res) || res.length < 2) throw new Error('Unexpected Redis rate-limit response');
    const count = Number(res[0]);
    const ttl = Number(res[1]);
    if (!Number.isFinite(count) || count < 0 || !Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid Redis rate-limit response');
    return { count, resetAt: Date.now() + ttl };
  }
}

let sharedStore: RateLimitStore = new InMemoryStore();
let IORedis: any;
function loadIoredis() {
  try { return require('ioredis'); } catch { return undefined; }
}

export function createSharedRateLimitStoreFromEnv(): RateLimitStore {
  if (!config.isProduction) return new InMemoryStore();
  if (!config.redis.url) throw new Error('REDIS_URL is required for production rate limiting');
  IORedis ??= loadIoredis();
  if (!IORedis) throw new Error('ioredis is required for production rate limiting');
  const client = new IORedis(config.redis.url, { lazyConnect: true, enableReadyCheck: true, maxRetriesPerRequest: 2, connectTimeout: 5000, commandTimeout: 5000, retryStrategy: (times: number) => Math.min(times * 250, 2000) });
  client.on('error', (err: Error) => console.error('[RateLimiter] Redis error:', err.message));
  client.on('ready', () => console.info('[RateLimiter] Redis ready'));
  client.on('end', () => console.error('[RateLimiter] Redis connection ended; requests will fail closed'));
  void client.connect().catch((err: Error) => console.error('[RateLimiter] Redis initial connection failed:', err.message));
  return new RedisStore(createAtomicRateLimitClient('ioredis', client));
}
if (config.isProduction) sharedStore = createSharedRateLimitStoreFromEnv();
export function setRateLimiterStore(s: RateLimitStore) { if (!isTestMode()) throw new Error('setRateLimiterStore is only available in test mode'); sharedStore = s; }

export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const tenantId = (req as AuthenticatedRequest).user?.tenantId;
  const key = tenantId ? `rl:tenant:${tenantId}:ip:${ip}` : `rl:ip:${ip}`;
  try {
    const counter = await sharedStore.incr(key, rateLimitWindowMs, maxRequestsPerWindow);
    res.setHeader('X-RateLimit-Limit', String(maxRequestsPerWindow));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequestsPerWindow - counter.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(counter.resetAt / 1000)));
    if (counter.count > maxRequestsPerWindow) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((counter.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
    }
    return next();
  } catch (err) {
    const requestId = randomUUID();
    console.error('[RateLimiter] fail-closed (requestId=%s): %s', requestId, err instanceof Error ? err.message : String(err));
    return res.status(503).json({ error: { code: 'RATE_LIMIT_STORE_UNAVAILABLE', message: 'This operation is temporarily unavailable.', requestId } });
  }
};

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || token.length > 8192) return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token' });
  try {
    const decodedToken = await adminAuth.verifyIdToken(token, true);
    const uid = decodedToken.uid;
    if (!uid || typeof uid !== 'string' || uid.length > 256) return res.status(401).json({ error: 'Unauthorized: Invalid security token' });

    const isVerificationExemptPath = ['/api/user/me', '/api/auth/resend-verification', '/api/auth/verify-status'].includes(req.path);
    const emailVerified = decodedToken.email_verified === true;
    if (!emailVerified && !isVerificationExemptPath) return res.status(403).json({ error: 'Email verification required', code: 'EMAIL_NOT_VERIFIED' });

    // Authorization is anchored to the immutable Firebase UID. Never fall back
    // to an email lookup: a different Firebase account must never inherit an
    // existing user's tenant or RBAC record because the email happens to match.
    const dbUser = await db.select().from(users).where(eq(users.uid, uid)).then(rows => rows[0]);
    if (!dbUser) return res.status(403).json({ error: 'User account is not provisioned' });
    if (!dbUser.tenantId || dbUser.tenantId.length > 256) return res.status(403).json({ error: 'User account has invalid tenant configuration' });
    if (!dbUser.role || dbUser.role.length > 64) return res.status(403).json({ error: 'User account has invalid role configuration' });

    const dbEmail = dbUser.email.trim().toLowerCase();
    const tokenEmail = typeof decodedToken.email === 'string' ? decodedToken.email.trim().toLowerCase() : '';
    if (tokenEmail && dbEmail && tokenEmail !== dbEmail) return res.status(403).json({ error: 'User identity does not match the provisioned account' });

    req.user = { id: dbUser.id, uid, email: dbUser.email, tenantId: dbUser.tenantId, role: dbUser.role, emailVerified };
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired security token' });
  }
};

export function requireRole(roles: string | string[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}
