import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforcePaidAccess } from '../src/middleware/security.ts';
import { BASELINE_CAPABILITY, PLAN_CAPABILITY_MATRIX, PLAN_ENTITLING_STATUSES, capabilityForPath, lapsedPlanAllows, resolveSubscriptionGate } from '../src/security/entitlements.ts';
import type { ScopedDb } from '../src/middleware/tenant-scope.ts';
import type { AuthenticatedRequest } from '../src/middleware/security.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const TENANT = 'tenant-under-test';

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks.map(chunk => {
    if (typeof chunk === 'string') return chunk;
    if ((chunk as { queryChunks?: unknown[] }).queryChunks) return sqlText(chunk);
    const value = (chunk as { value?: unknown }).value;
    return Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '';
  }).join(' ');
}

async function runGate(options: { baseUrl: string; path: string; subscription: { plan: string | null; status: string } | null; planHasCapability?: boolean; user?: { tenantId: string } | null }) {
  const queries: unknown[] = [];
  const db = { execute: async (query: unknown) => { queries.push(query); return sqlText(query).includes('plan_capabilities') ? { rows: [{ allowed: options.planHasCapability ?? false }] } : { rows: options.subscription ? [options.subscription] : [] }; } } as unknown as ScopedDb;
  let status: number | null = null;
  let body: Record<string, unknown> | null = null;
  const locals: Record<string, unknown> = {};
  const res = { locals, status(code: number) { status = code; return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
  const user = options.user === undefined ? { tenantId: TENANT } : options.user;
  const req = { baseUrl: options.baseUrl, path: options.path, ...(user ? { user, db } : {}) } as unknown as AuthenticatedRequest;
  const allowed = await enforcePaidAccess(req, res as unknown as Parameters<typeof enforcePaidAccess>[1]);
  return { allowed, status, body, locals, queries };
}

describe('paid access contract', () => {
  it('allows an authenticated workspace with no subscription row', async () => {
    const run = await runGate({ baseUrl: '/api', path: '/scans', subscription: null });
    expect(run.allowed).toBe(true);
    expect(run.status).toBeNull();
    expect(run.locals.billing).toMatchObject({ plan: null, status: 'none', gate: 'default-access' });
    expect(run.queries.map(sqlText).some(text => text.includes('plan_capabilities'))).toBe(false);
  });

  it('enforces paid capabilities once a plan is recorded', async () => {
    const allowed = await runGate({ baseUrl: '/api', path: '/scans', subscription: { plan: 'starter', status: 'active' }, planHasCapability: true });
    expect(allowed.allowed).toBe(true);
    const denied = await runGate({ baseUrl: '/api', path: '/vendors', subscription: { plan: 'starter', status: 'active' }, planHasCapability: false });
    expect(denied.allowed).toBe(false);
    expect(denied.status).toBe(402);
  });

  it('keeps workspace access for canceled and unpaid plans', async () => {
    for (const status of ['canceled', 'unpaid']) {
      const run = await runGate({ baseUrl: '/api', path: '/user/clients', subscription: { plan: 'growth', status } });
      expect(run.allowed).toBe(true);
      expect(run.locals.billing).toMatchObject({ gate: 'lapsed' });
    }
  });

  it('preserves the entitlement model', () => {
    expect(BASELINE_CAPABILITY).toBe('workspace');
    expect(PLAN_ENTITLING_STATUSES).toEqual(['active', 'trialing', 'past_due']);
    for (const capabilities of Object.values(PLAN_CAPABILITY_MATRIX)) expect(capabilities).toContain(BASELINE_CAPABILITY);
    expect(lapsedPlanAllows('workspace')).toBe(true);
    expect(lapsedPlanAllows('bulk_export')).toBe(false);
    expect(resolveSubscriptionGate({ plan: 'growth', status: 'incomplete' })).toBe('default-access');
    expect(resolveSubscriptionGate({ plan: 'growth', status: 'active' })).toBe('enforce-plan');
    expect(resolveSubscriptionGate({ plan: 'growth', status: 'canceled' })).toBe('lapsed');
  });

  it('keeps billing and identity endpoints exempt from paid-access enforcement', async () => {
    for (const [baseUrl, routePath] of [
      ['/api/billing', '/checkout'],
      ['/api/billing', '/one-time-checkout'],
      ['/api', '/user/me'],
      ['/api/auth', '/resend-verification'],
      ['/api/auth', '/verify-status'],
    ]) {
      const run = await runGate({ baseUrl, path: routePath, subscription: { plan: 'growth', status: 'canceled' } });
      expect(run.allowed).toBe(true);
      expect(run.status).toBeNull();
      expect(run.queries).toHaveLength(0);
    }
  });

  it('keeps the Founder Command Center outside customer billing while requiring founder authorization', () => {
    const source = read('src/middleware/security.ts');
    expect(source).toContain("'/api/founder'");
    expect(source).toContain('export function requireFounder');
    expect(source).toContain('FOUNDER_ONLY');
  });

  it('maps representative routes to the priced capabilities', () => {
    expect(capabilityForPath({ baseUrl: '/api', path: '/scans' } as unknown as Parameters<typeof capabilityForPath>[0])).toBe('sbom');
    expect(capabilityForPath({ baseUrl: '/api', path: '/user/passports' } as unknown as Parameters<typeof capabilityForPath>[0])).toBe('passport');
    expect(capabilityForPath({ baseUrl: '/api', path: '/vendors' } as unknown as Parameters<typeof capabilityForPath>[0])).toBe('vendor_risk');
  });
});
