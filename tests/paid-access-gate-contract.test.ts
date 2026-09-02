import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforcePaidAccess } from '../src/middleware/security.ts';
import {
  BASELINE_CAPABILITY,
  PLAN_CAPABILITY_MATRIX,
  PLAN_ENTITLING_STATUSES,
  capabilityForPath,
  lapsedPlanAllows,
  resolveSubscriptionGate,
} from '../src/security/entitlements.ts';
import type { ScopedDb } from '../src/middleware/tenant-scope.ts';
import type { AuthenticatedRequest } from '../src/middleware/security.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// The seven authenticated workspace endpoints that regressed to a blanket
// HTTP 402 in production for a tenant that had never been through checkout.
// Verified against the live Railway HTTP logs on 2026-09-02.
const REGRESSED_ENDPOINTS = [
  { baseUrl: '/api', path: '/integrations', capability: 'api' },
  { baseUrl: '/api', path: '/user/clients', capability: 'workspace' },
  { baseUrl: '/api', path: '/scans', capability: 'sbom' },
  { baseUrl: '/api', path: '/user/passports', capability: 'passport' },
  { baseUrl: '/api', path: '/vendors', capability: 'vendor_risk' },
  { baseUrl: '/api/trust-loop', path: '/findings', capability: 'passport' },
  { baseUrl: '/api', path: '/user/verification', capability: 'workspace' },
] as const;

const TENANT = 'tenant-under-test';

interface SubscriptionFixture { plan: string | null; status: string; currentPeriodEnd?: string | null }

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map(chunk => {
      if (typeof chunk === 'string') return chunk;
      if ((chunk as { queryChunks?: unknown[] }).queryChunks) return sqlText(chunk);
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value)) return value.join('');
      return typeof value === 'string' ? value : '';
    })
    .join(' ');
}

function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.flatMap(chunk => {
    // drizzle inlines a template value as the bare JS primitive; a StringChunk
    // carries the literal SQL as string[], which is not a bound parameter.
    if (chunk === null || typeof chunk !== 'object') return [chunk];
    if ((chunk as { queryChunks?: unknown[] }).queryChunks) return sqlParams(chunk);
    const value = (chunk as { value?: unknown }).value;
    return Array.isArray(value) || value === undefined ? [] : [value];
  });
}

interface GateRun {
  allowed: boolean;
  status: number | null;
  body: Record<string, unknown> | null;
  locals: Record<string, unknown>;
  queries: unknown[];
}

/**
 * Drives the real enforcePaidAccess() middleware. Nothing is stubbed except
 * the tenant-scoped database handle, so the capability mapping, the gate
 * decision and the denial payload under test are the production ones.
 */
async function runGate(options: {
  baseUrl: string;
  path: string;
  subscription: SubscriptionFixture | null;
  planHasCapability?: boolean;
  user?: { tenantId: string } | undefined;
  body?: unknown;
}): Promise<GateRun> {
  const queries: unknown[] = [];
  const db = {
    execute: async (query: unknown) => {
      queries.push(query);
      if (sqlText(query).includes('plan_capabilities')) {
        return { rows: [{ allowed: options.planHasCapability ?? false }] };
      }
      return { rows: options.subscription ? [options.subscription] : [] };
    },
  } as unknown as ScopedDb;

  let status: number | null = null;
  let body: Record<string, unknown> | null = null;
  const locals: Record<string, unknown> = {};
  const res = {
    locals,
    status(code: number) { status = code; return this; },
    json(value: Record<string, unknown>) { body = value; return this; },
  };

  const user = options.user === undefined ? { tenantId: TENANT } : options.user;
  const req = {
    baseUrl: options.baseUrl,
    path: options.path,
    body: options.body,
    ...(user ? { user, db } : {}),
  } as unknown as AuthenticatedRequest;

  const allowed = await enforcePaidAccess(req, res as unknown as Parameters<typeof enforcePaidAccess>[1]);
  return { allowed, status, body, locals, queries };
}

describe('REGRESSION: a tenant with no subscription row is not billed-out of its own workspace', () => {
  // This is the exact production failure being guarded against. Every one of
  // these endpoints returned 402 SUBSCRIPTION_REQUIRED for an authenticated,
  // email-verified Owner whose tenant had no tenant_subscriptions row.
  it.each(REGRESSED_ENDPOINTS.map(endpoint => [`${endpoint.baseUrl}${endpoint.path}`, endpoint] as const))(
    '%s is allowed through with no subscription row and never answers 402',
    async (_label, endpoint) => {
      const run = await runGate({ baseUrl: endpoint.baseUrl, path: endpoint.path, subscription: null });
      expect(run.allowed).toBe(true);
      expect(run.status).toBeNull();
      expect(run.body).toBeNull();
    },
  );

  it.each(REGRESSED_ENDPOINTS.map(endpoint => [`${endpoint.baseUrl}${endpoint.path}`, endpoint] as const))(
    '%s maps to the capability the plan matrix actually prices',
    (_label, endpoint) => {
      const req = { baseUrl: endpoint.baseUrl, path: endpoint.path } as unknown as Parameters<typeof capabilityForPath>[0];
      expect(capabilityForPath(req)).toBe(endpoint.capability);
    },
  );

  it('never consults plan_capabilities at all when no plan is on record', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: null });
    expect(run.allowed).toBe(true);
    expect(run.queries.map(sqlText).some(text => text.includes('plan_capabilities'))).toBe(false);
  });

  it('records the gate it took, so the decision is observable rather than implicit', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/user/clients', subscription: null });
    expect(run.locals.billing).toMatchObject({ plan: null, status: 'none', gate: 'default-access' });
  });

  it('a row that exists but records no plan is still the unrestricted default', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/vendors', subscription: { plan: null, status: 'incomplete' } });
    expect(run.allowed).toBe(true);
    expect(run.status).toBeNull();
  });

  it('starting a checkout and abandoning it does not reduce access', async () => {
    // POST /api/billing/checkout writes status 'incomplete' before the customer
    // ever reaches Stripe. If that state were enforced, clicking Subscribe
    // would lock the workspace the user is trying to pay for.
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: { plan: 'growth', status: 'incomplete' } });
    expect(run.allowed).toBe(true);
    expect(run.status).toBeNull();
  });
});

describe('paid features stay paid: enforcement is real once a plan is recorded', () => {
  it('an active plan that includes the capability is allowed', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: { plan: 'starter', status: 'active' }, planHasCapability: true });
    expect(run.allowed).toBe(true);
    expect(run.locals.billing).toMatchObject({ plan: 'starter', status: 'active', gate: 'enforce-plan' });
  });

  it('an active plan that does NOT include the capability is refused with 402 CAPABILITY_NOT_INCLUDED', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/vendors', subscription: { plan: 'starter', status: 'active' }, planHasCapability: false });
    expect(run.allowed).toBe(false);
    expect(run.status).toBe(402);
    expect(run.body).toMatchObject({ code: 'CAPABILITY_NOT_INCLUDED', capability: 'vendor_risk', plan: 'starter', billingPath: '/billing' });
  });

  it('a trialing plan is enforced against the same capability matrix', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/integrations', subscription: { plan: 'growth', status: 'trialing' }, planHasCapability: true });
    expect(run.allowed).toBe(true);
    expect(run.locals.billing).toMatchObject({ gate: 'enforce-plan' });
  });

  it('a past_due plan keeps its capabilities while Stripe retries payment, rather than cutting a paying customer off mid-dunning', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: { plan: 'professional', status: 'past_due' }, planHasCapability: true });
    expect(run.allowed).toBe(true);
    expect(run.locals.billing).toMatchObject({ status: 'past_due', gate: 'enforce-plan' });
  });

  it('the SQL capability check accepts exactly the entitling statuses, so it cannot drift from the gate', () => {
    const source = read('src/security/entitlements.ts');
    expect(source).toContain('AND ts.status IN (${ENTITLING_STATUSES_SQL})');
    expect(PLAN_ENTITLING_STATUSES).toEqual(['active', 'trialing', 'past_due']);
  });
});

describe('cancelled / unpaid subscriptions degrade instead of deleting or hiding the tenant data', () => {
  it.each(['canceled', 'unpaid'])('a %s subscription refuses paid capabilities with 402 SUBSCRIPTION_REQUIRED', async status => {
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: { plan: 'growth', status }, planHasCapability: true });
    expect(run.allowed).toBe(false);
    expect(run.status).toBe(402);
    expect(run.body).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', subscriptionStatus: status, plan: 'growth', billingPath: '/billing' });
  });

  it.each(['canceled', 'unpaid'])('a %s subscription still reaches its own workspace, so the account is never locked out of its data', async status => {
    const run = await runGate({ baseUrl: '/api', path: '/user/clients', subscription: { plan: 'growth', status } });
    expect(run.allowed).toBe(true);
    expect(run.status).toBeNull();
    expect(run.locals.billing).toMatchObject({ gate: 'lapsed' });
  });

  it('the retained floor is the one capability every plan includes', () => {
    expect(BASELINE_CAPABILITY).toBe('workspace');
    for (const [plan, capabilities] of Object.entries(PLAN_CAPABILITY_MATRIX)) {
      expect(capabilities, `${plan} must include the baseline capability`).toContain(BASELINE_CAPABILITY);
    }
    expect(lapsedPlanAllows('workspace')).toBe(true);
    expect(lapsedPlanAllows('bulk_export')).toBe(false);
  });
});

describe('every status the database can hold is classified explicitly', () => {
  const migrationStatuses = (() => {
    const migration = read('migrations/0031_billing.sql');
    const match = /status text NOT NULL DEFAULT 'incomplete' CHECK \(status IN \(([^)]*)\)\)/.exec(migration);
    expect(match, 'migration 0031 must still declare the status CHECK constraint').toBeTruthy();
    return (match?.[1] ?? '').split(',').map(value => value.trim().replaceAll("'", ''));
  })();

  it('covers the same status set the tenant_subscriptions CHECK constraint allows', () => {
    expect(migrationStatuses).toEqual(['incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid']);
  });

  it.each([
    ['none', null, 'default-access'],
    ['incomplete', 'growth', 'default-access'],
    ['trialing', 'growth', 'enforce-plan'],
    ['active', 'growth', 'enforce-plan'],
    ['past_due', 'growth', 'enforce-plan'],
    ['canceled', 'growth', 'lapsed'],
    ['unpaid', 'growth', 'lapsed'],
  ])('status "%s" on plan %s resolves to the "%s" gate', (status, plan, expected) => {
    expect(resolveSubscriptionGate({ plan, status })).toBe(expected);
  });

  it('an unrecognised future status fails closed to lapsed rather than granting paid capabilities', () => {
    expect(resolveSubscriptionGate({ plan: 'growth', status: 'paused' })).toBe('lapsed');
  });
});

describe('authentication, tenant isolation and billing exemptions are unchanged', () => {
  it('an unauthenticated request never reaches the gate: requireAuth rejects a missing token first', () => {
    const source = read('src/middleware/security.ts');
    expect(source).toContain("if (!token || token.length > 8192) return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token' })");
    expect(source).toContain('verifyIdToken(token, true)');
    // The gate still runs inside requireAuth -- enforcement was not removed.
    expect(source).toContain('if (!(await enforcePaidAccess(req, res))) return;');
  });

  it('a request with no authenticated workspace is refused, not defaulted to allowed', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: null, user: null as unknown as undefined });
    expect(run.allowed).toBe(false);
    expect(run.status).toBe(403);
    expect(run.body).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED' });
  });

  it('reads the subscription only for the authenticated tenant, never a client-supplied one', async () => {
    const run = await runGate({
      baseUrl: '/api',
      path: '/scans',
      subscription: { plan: 'growth', status: 'active' },
      planHasCapability: true,
      body: { tenantId: 'attacker-tenant' },
    });
    const parameters = run.queries.flatMap(sqlParams);
    expect(parameters).toContain(TENANT);
    expect(parameters).not.toContain('attacker-tenant');
    expect(run.queries.map(sqlText).join(' ')).toContain('WHERE tenant_id =');
  });

  it('billing and identity endpoints stay exempt, so a lapsed tenant can always pay or be identified', async () => {
    for (const [baseUrl, routePath] of [
      ['/api/billing', '/'],
      ['/api/billing', '/checkout'],
      ['/api/billing', '/one-time-checkout'],
      ['/api/billing', '/portal'],
      ['/api', '/user/me'],
      ['/api/auth', '/resend-verification'],
      ['/api/auth', '/verify-status'],
    ]) {
      const run = await runGate({ baseUrl, path: routePath, subscription: { plan: 'growth', status: 'canceled' } });
      expect(run.allowed, `${baseUrl}${routePath} must remain billing-exempt`).toBe(true);
      expect(run.status).toBeNull();
      expect(run.queries, `${baseUrl}${routePath} must short-circuit before any query`).toHaveLength(0);
    }
  });

  it('the one-time purchase endpoint is mounted under the exempt billing prefix', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/billing', createBillingRouter())");
    expect(read('src/routes/billing.ts')).toContain("router.post('/one-time-checkout', requireAuth");
    expect(read('src/middleware/security.ts')).toContain("const BILLING_EXEMPT_PATHS = ['/api/billing','/api/user/me','/api/auth/resend-verification','/api/auth/verify-status']");
  });
});
