/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { adminAuth, setUserCustomClaims } from '../lib/firebase-admin.ts';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

// Extend Express Request type
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    uid: string;
    email: string;
    tenantId: string;
    role: string;
    emailVerified: boolean;
  };
}

// 1. Shared-store aware rate limiter to prevent API abuse
let rateLimitWindowMs = 60 * 1000; // 1 minute
let maxRequestsPerWindow = 100;    // max 100 requests per window
const isTestMode = () => process.env.NODE_ENV !== 'production';

// For tests: allow overriding rate limit configuration
export function setRateLimiterConfig(opts: { windowMs?: number; maxRequests?: number }) {
  if (!isTestMode()) {
    throw new Error('setRateLimiterConfig is only available in test mode');
  }
  if (typeof opts.windowMs === 'number') rateLimitWindowMs = opts.windowMs;
  if (typeof opts.maxRequests === 'number') maxRequestsPerWindow = opts.maxRequests;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimitStore {
  incr(key: string, windowMs: number, limit: number): Promise<RateLimitRecord>;
  get?(key: string): Promise<RateLimitRecord | undefined | null>;
}

// Simple in-memory store used for development and tests
class InMemoryStore implements RateLimitStore {
  private map = new Map<string, { count: number; resetAt: number }>();

  async incr(key: string, windowMs: number, limit: number) {
    const now = Date.now();
    const rec = this.map.get(key);
    if (!rec || now > rec.resetAt) {
      const next = { count: 1, resetAt: now + windowMs };
      this.map.set(key, next);
      return next;
    }
    rec.count += 1;
    return rec;
  }

  async get(key: string) {
    return this.map.get(key);
  }
}

interface AtomicRateLimitClient {
  increment(script: string, key: string, windowMs: number, limit: number): Promise<unknown>;
}

export class IORedisAtomicClient implements AtomicRateLimitClient {
  constructor(
    private readonly client: {
      eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
    }
  ) {}

  increment(script: string, key: string, windowMs: number, limit: number) {
    return this.client.eval(script, 1, key, String(windowMs), String(limit));
  }
}

export function createAtomicRateLimitClient(provider: 'ioredis', client: any): AtomicRateLimitClient {
  if (provider === 'ioredis') {
    if (!client || typeof client.eval !== 'function') {
      throw new Error('Invalid ioredis client; expected eval(script, numKeys, ...args)');
    }
    return new IORedisAtomicClient(client);
  }

  throw new Error(`Unsupported rate limit provider: ${provider}`);
}

export class RedisStore implements RateLimitStore {
  private readonly lua =
    `local count = redis.call("INCR", KEYS[1])\n` +
    `local ttl = redis.call("PTTL", KEYS[1])\n` +
    `if count == 1 or ttl < 0 then\n` +
    `  redis.call("PEXPIRE", KEYS[1], ARGV[1])\n` +
    `  ttl = tonumber(ARGV[1])\n` +
    `end\n` +
    `return {count, ttl}`;

  private readonly fallbackStore = new InMemoryStore();

  constructor(
    private readonly atomicClient: AtomicRateLimitClient,
    private readonly rawClient?: {
      get?: (key: string) => Promise<unknown>;
      pttl?: (key: string) => Promise<unknown>;
    },
    // When false (default), a Redis failure is NOT masked by an in-memory fallback:
    // the error propagates so the calling middleware can fail closed (503) instead of
    // silently rate-limiting per-instance, which weakens the effective global limit
    // across a multi-instance deployment during an outage. Set true to restore the
    // old fail-open behavior.
    private readonly failOpen: boolean = false
  ) {}

  async incr(key: string, windowMs: number, limit: number) {
    const now = Date.now();

    try {
      const res = await this.atomicClient.increment(this.lua, key, windowMs, limit);

      if (!Array.isArray(res) || res.length < 2) {
        throw new Error('Unexpected redis eval response');
      }

      const count = Number(res[0]);
      const ttl = Number(res[1]);

      if (!Number.isFinite(count) || count < 0) {
        throw new Error('Unexpected redis eval response');
      }
      if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new Error('Unexpected redis eval response');
      }

      return { count, resetAt: now + ttl };
    } catch (err) {
      if (this.failOpen) {
        console.error('[RateLimiter] Redis store unavailable, falling back to in-memory store: %s', err?.message || err);
        return this.fallbackStore.incr(key, windowMs, limit);
      }
      // Fail closed: rethrow so the rateLimiter middleware returns 503 instead of
      // silently weakening the rate limit during a Redis outage.
      throw err;
    }
  }

  async get(key: string) {
    if (!this.rawClient) return undefined;

    try {
      const val = this.rawClient.get ? await this.rawClient.get(key) : null;
      if (val == null) return undefined;
      const count = Number(val);
      if (!Number.isFinite(count)) return undefined;
      let ttl = -1;
      if (typeof this.rawClient.pttl === 'function') {
        ttl = Number(await this.rawClient.pttl(key));
      }
      if (!Number.isFinite(ttl) || ttl < 0) ttl = 0;
      return { count, resetAt: Date.now() + ttl };
    } catch (err) {
      console.error('[RateLimiter] Redis store unavailable during get(), falling back to in-memory store: %s', err?.message || err);
      return undefined;
    }
  }
}

// Try to initialize a shared store using existing dependencies if available
let sharedStore: RateLimitStore = new InMemoryStore();
let hasIoredis = false;
let IORedis: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const req: any = require;
  try { IORedis = req('ioredis'); hasIoredis = true; } catch (e) {}
} catch (e) {}

function attachRedisErrorHandlers(client: any) {
  if (!client || typeof client.on !== 'function') return;

  let hasDegraded = false;
  const degradeOnce = (message: string) => {
    if (hasDegraded) return;
    hasDegraded = true;
    console.error('[RateLimiter] %s Falling back to in-memory rate limiting.', message);
    sharedStore = new InMemoryStore();
  };

  client.on('error', (err: Error) => {
    degradeOnce(`Redis client error event: ${err?.message || err}`);
  });

  client.on('end', () => {
    degradeOnce('Redis connection ended.');
  });

  client.on('connect', () => {
    console.info('[RateLimiter] Redis client connecting');
  });

  client.on('ready', () => {
    console.info('[RateLimiter] Redis client ready');
  });
}

export function createSharedRateLimitStoreFromEnv(): RateLimitStore {
  if (!config.isProduction) {
    return new InMemoryStore();
  }

  const redisUrl = config.redis.url;
  if (!redisUrl) {
    console.warn('[RateLimiter] REDIS_URL is not configured in production. Falling back to in-memory rate limiting.');
    return new InMemoryStore();
  }

  if (!hasIoredis || !IORedis) {
    console.warn('[RateLimiter] ioredis is not installed. Falling back to in-memory rate limiting.');
    return new InMemoryStore();
  }

  const client = new IORedis(redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    reconnectOnError: (err: Error) => {
      console.warn('[RateLimiter] Redis reconnect on error: %s', err?.message || err);
      return true;
    },
  });

  attachRedisErrorHandlers(client);
  void client.connect().catch((err: Error) => {
    console.error('[RateLimiter] Failed to connect to Redis at startup: %s. Falling back to in-memory rate limiting.', err?.message || err);
    sharedStore = new InMemoryStore();
  });

  return new RedisStore(createAtomicRateLimitClient('ioredis', client), client, config.redis.failOpen);
}

if (config.isProduction) {
  sharedStore = createSharedRateLimitStoreFromEnv();
}

// Export helper for tests to inject a store
export function setRateLimiterStore(s: RateLimitStore) {
  if (!isTestMode()) {
    throw new Error('setRateLimiterStore is only available in test mode');
  }
  sharedStore = s;
}

export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const tenantId = (req as AuthenticatedRequest).user?.tenantId;
  const key = tenantId
    ? `rl:tenant:${tenantId}:ip:${ip}`
    : `rl:ip:${ip}`;

  try {
    const counter = await sharedStore.incr(key, rateLimitWindowMs, maxRequestsPerWindow);
    if (
      !counter ||
      !Number.isFinite(counter.count) ||
      !Number.isFinite(counter.resetAt)
    ) {
      throw new Error('Malformed shared store response');
    }

    const remaining = Math.max(0, maxRequestsPerWindow - counter.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequestsPerWindow));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(counter.resetAt / 1000)));
    if (counter.count > maxRequestsPerWindow) {
      res.setHeader('Retry-After', String(Math.ceil((counter.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ error: 'Too Many Requests' });
    }
    return next();
  } catch (err) {
    // Fail closed for security-sensitive middleware. Return a safe, non-leaking error body.
    const requestId = randomUUID();
    console.error('[RateLimiter] Shared store error: (requestId=%s) %s', requestId, err?.message || err);
    return res.status(503).json({
      error: {
        code: 'RATE_LIMIT_STORE_UNAVAILABLE',
        message: 'This operation is temporarily unavailable.',
        requestId,
      }
    });
  }
};

// 2. Multi-Tenant Sync & Authentication Middleware
export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split('Bearer ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token' });
  }

  try {
    let decodedToken: any;
    try {
      decodedToken = await adminAuth.verifyIdToken(token, true);
    } catch (err: any) {
      console.warn('[Security Auth Middleware] Token verification failed:', err?.message || err);
      return res.status(401).json({ 
        error: 'Unauthorized: Invalid or expired security token',
        message: err?.message || 'Token verification failed'
      });
    }

    const uid = decodedToken.uid;
    const email = decodedToken.email || `${uid}@user.local`;
    const emailVerified = !!decodedToken.email_verified;

    // Check email verification enforcement
    // Allow profile lookup and verification endpoints even if unverified so frontend can show verification status
    const isVerificationExemptPath = 
      req.path === '/api/user/me' || 
      req.path === '/api/auth/resend-verification' || 
      req.path === '/api/auth/verify-status';

    if (!emailVerified && !isVerificationExemptPath) {
      return res.status(403).json({
        error: 'Email verification required',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Your email address must be verified before accessing workspace resources.',
      });
    }

    // Determine default tenant ID based on email domain
    const domain = email.split('@')[1] || 'generic';
    const isPublicDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'].includes(domain.toLowerCase());
    const defaultTenantId = isPublicDomain ? `tenant-${uid}` : `tenant-${domain}`;

    // Perform database lookup for the user
    let dbUser = await db.select().from(users).where(eq(users.uid, uid)).then(rows => rows[0]);

    if (!dbUser) {
      // Look up by email to see if they were invited/pre-registered via an invitation flow
      dbUser = await db.select().from(users).where(eq(users.email, email)).then(rows => rows[0]);

      if (dbUser) {
        // User was invited with a pre-assigned role and tenantId
        const previousUid = dbUser.uid;
        const previousOnboarded = dbUser.onboarded;
        const updated = await db.update(users)
          .set({ uid, onboarded: 1 })
          .where(eq(users.id, dbUser.id))
          .returning();
        dbUser = updated[0];
        
        // Sync custom claims to Firebase Admin SDK for tenant isolation and RBAC
        const claimRes1 = await setUserCustomClaims(uid, {
          workspaceId: dbUser.tenantId,
          role: dbUser.role
        });
        if (!claimRes1.success) {
          await db.update(users)
            .set({ uid: previousUid, onboarded: previousOnboarded })
            .where(eq(users.id, dbUser.id));
          console.error(`[Multi-Tenant Auth Denied] Custom claims push failed for invited user ${email}: ${claimRes1.reason}`);
          return res.status(403).json({ error: `Forbidden: Security claim assignment failed (${claimRes1.reason})` });
        }
        console.log(`[Multi-Tenant Auth] Bound invited user: ${email} to Tenant: ${dbUser.tenantId} with Role: ${dbUser.role}`);
      } else {
        // Self-registered user: DEFAULT TO VIEWER ROLE ONLY. NO self-selected roles allowed!
        const inserted = await db.insert(users)
          .values({
            uid,
            email,
            tenantId: defaultTenantId,
            role: 'Viewer', // STRICT MANDATE: Default role for self-signup is Viewer only.
            onboarded: 0,
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: { email },
          })
          .returning();
        dbUser = inserted[0];

        // Set custom claims on Firebase Admin
        const claimRes2 = await setUserCustomClaims(uid, {
          workspaceId: dbUser.tenantId,
          role: dbUser.role
        });
        if (!claimRes2.success) {
          await db.delete(users).where(eq(users.id, dbUser.id));
          console.error(`[Multi-Tenant Auth Denied] Custom claims push failed for new user ${email}: ${claimRes2.reason}`);
          return res.status(403).json({ error: `Forbidden: Security claim assignment failed (${claimRes2.reason})` });
        }
        console.log(`[Multi-Tenant Auth] Registered new user: ${email} with default Viewer role on Tenant: ${defaultTenantId}`);
      }
    } else {
      // Tenant and role claims are mandatory on every workspace request. Firebase
      // claim updates do not alter an already-issued ID token, so synchronize the
      // account but deny this request until the client obtains a fresh token.
      const claimRole = decodedToken.role;
      const claimWorkspace = decodedToken.workspaceId || decodedToken.tenantId;

      if (!claimRole || !claimWorkspace) {
        const claimResult = await setUserCustomClaims(uid, {
          workspaceId: dbUser.tenantId,
          role: dbUser.role
        });
        if (!claimResult.success) {
          console.error('[Multi-Tenant Auth Denied]', {
            uid,
            code: 'REQUIRED_CLAIMS_ASSIGNMENT_FAILED'
          });
          return res.status(403).json({
            error: 'Forbidden: Required tenant or role claim is missing',
            code: 'TOKEN_CLAIMS_MISSING'
          });
        }
        return res.status(403).json({
          error: 'Forbidden: Authentication claims were refreshed; obtain a new token',
          code: 'TOKEN_CLAIMS_REFRESH_REQUIRED'
        });
      }

      if (claimRole !== dbUser.role || claimWorkspace !== dbUser.tenantId) {
        const claimRes3 = await setUserCustomClaims(uid, {
          workspaceId: dbUser.tenantId,
          role: dbUser.role
        });
        if (!claimRes3.success) {
          console.error(`[Multi-Tenant Auth Denied] Custom claims sync failed for user ${email}: ${claimRes3.reason}`);
          return res.status(403).json({ error: `Forbidden: Security claim sync failed (${claimRes3.reason})` });
        }
        return res.status(403).json({
          error: 'Forbidden: Authentication claims changed; obtain a new token',
          code: 'TOKEN_CLAIMS_REFRESH_REQUIRED'
        });
      }
    }

    // Bind authenticated user metadata to request context
    req.user = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      tenantId: dbUser.tenantId,
      role: dbUser.role,
      emailVerified
    };

    next();
  } catch (error: any) {
    console.error('[Security Auth Middleware Error]:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

// 3. Role-Based Access Control (RBAC) Verification Middleware
//
// Roles form a single privilege ladder from least to most privileged. A role at a given
// rung can access anything gated to that rung or any rung below it. Auditor is a
// side-grant (read/compliance access) rather than a rung on the operational ladder, so it
// is listed explicitly wherever it should apply instead of being implied by rank.
const ROLE_HIERARCHY = ['Viewer', 'Technician', 'Admin', 'Owner'] as const;
type Role = typeof ROLE_HIERARCHY[number] | 'Auditor';

function resolveEffectiveRoles(allowedRoles: string[]): Set<string> {
  const effective = new Set<string>(allowedRoles);

  for (const role of allowedRoles) {
    if (role === 'Auditor') {
      // Auditor-gated resources are also reachable by the two most-privileged rungs.
      effective.add('Admin');
      effective.add('Owner');
      continue;
    }
    const rank = ROLE_HIERARCHY.indexOf(role as typeof ROLE_HIERARCHY[number]);
    if (rank === -1) continue; // unrecognized role: no rank-based escalation
    // Every rung above this one inherits access.
    for (let i = rank + 1; i < ROLE_HIERARCHY.length; i++) {
      effective.add(ROLE_HIERARCHY[i]);
    }
    // Auditor has read access anywhere Viewer does.
    if (ROLE_HIERARCHY[rank] === 'Viewer') {
      effective.add('Auditor');
    }
  }

  return effective;
}

export const requireRole = (allowedRoles: string[]) => {
  const effectiveRoles = resolveEffectiveRoles(allowedRoles);

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const userRole = req.user.role;

    if (!effectiveRoles.has(userRole)) {
      return res.status(403).json({
        error: 'Forbidden: Insufficient privileges',
        message: `Your role (${userRole}) does not have permission to access this resource. Allowed roles: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};
