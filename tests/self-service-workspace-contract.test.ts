import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Assertions must be satisfied by CODE, never by the explanatory comments
// that sit directly above it -- those comments name every identifier this
// file checks for, so leaving them in would let the contract pass on prose
// alone.
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const workspaceRoute = () => {
  const source = stripComments(read('src/routes/auth.ts'));
  const start = source.indexOf("router.post('/auth/workspace'");
  expect(start).toBeGreaterThan(-1);
  // Scope every assertion to this handler so a match elsewhere in the very
  // large auth router can never satisfy it by accident.
  const rest = source.slice(start + 1);
  const end = rest.indexOf('  router.');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('self-service workspace creation contract', () => {
  it('authenticates the caller with the same revocation-aware check requireAuth uses', () => {
    const handler = workspaceRoute();
    expect(handler).toContain('verifyIdToken(token, true)');
    expect(handler).toContain("startsWith('Bearer ')");
  });

  it('refuses to provision an unverified email address', () => {
    const handler = workspaceRoute();
    expect(handler).toContain('decoded.email_verified !== true');
    expect(handler).toContain('EMAIL_NOT_VERIFIED');
  });

  it('lets an existing membership win, so it can never move a user between tenants', () => {
    const handler = workspaceRoute();
    const existingLookup = handler.indexOf('eq(users.uid, uid)');
    const insert = handler.indexOf('INSERT INTO users');
    expect(existingLookup).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    // The membership check must precede the insert and return early.
    expect(existingLookup).toBeLessThan(insert);
    expect(handler).toContain('created: false');
  });

  it('mints a fresh tenant and never accepts one from the caller', () => {
    const handler = workspaceRoute();
    expect(handler).toContain('crypto.randomUUID()');
    // A tenant id supplied by the client would be a direct cross-tenant
    // escape: the caller could name an existing workspace and be inserted
    // straight into it.
    expect(handler).not.toContain('req.body');
    expect(handler).not.toContain('req.query');
    expect(handler).not.toContain('req.params');
  });

  it('is idempotent against the users_uid_key unique index', () => {
    const handler = workspaceRoute();
    expect(handler).toContain('ON CONFLICT (uid) DO NOTHING');
  });

  it('grants Owner only over the newly created workspace', () => {
    const handler = workspaceRoute();
    expect(handler).toContain("'Owner'");
    expect(handler).toContain('workspaceId: tenantId');
  });

  it('records an audit entry scoped to the new tenant', () => {
    const handler = workspaceRoute();
    // Binds app.user_id as well as app.tenant_id, matching what every other
    // authenticated request establishes.
    expect(handler).toContain('attachTenantScope(tenantId, res, Number(created.id))');
    expect(handler).toContain("action: 'workspace.created'");
  });

  it('runs in the authenticated load, the one choke point every session passes through', () => {
    const app = stripComments(read('src/App.tsx'));
    expect(app).toContain("apiFetch('/api/auth/workspace', { method: 'POST' })");
    const call = app.indexOf("apiFetch('/api/auth/workspace'");
    const batch = app.indexOf("apiFetch('/api/user/me'), apiFetch('/api/scans')");
    expect(call).toBeGreaterThan(-1);
    expect(batch).toBeGreaterThan(-1);
    // Provisioning must complete before the batch load, or every request in
    // it answers 403 against an account that is not provisioned yet.
    expect(call).toBeLessThan(batch);
  });

  it('only provisions a verified identity from the client side too', () => {
    const app = stripComments(read('src/App.tsx'));
    expect(app).toContain('auth.currentUser?.emailVerified');
    expect(app).toContain('probe.status === 403');
  });

  it('suppresses the 403 auto-sign-out while provisioning is in flight', () => {
    const app = stripComments(read('src/App.tsx'));
    const begin = app.indexOf('beginSignupTransition()');
    const call = app.indexOf("apiFetch('/api/auth/workspace'");
    const end = app.indexOf('endSignupTransition()', call);
    // Without this the 403 handler in apiClient signs the user out mid-
    // provision and shows a stale "not a member of any workspace" notice.
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(call);
    expect(end).toBeGreaterThan(call);
  });

  it('refreshes the ID token after provisioning so stale claims are not used', () => {
    const app = stripComments(read('src/App.tsx'));
    const call = app.indexOf("apiFetch('/api/auth/workspace'");
    const refresh = app.indexOf('getIdToken(true)', call);
    expect(refresh).toBeGreaterThan(call);
  });

  it('keeps provisioning to a single path, not duplicated in LoginView', () => {
    const login = stripComments(read('src/components/LoginView.tsx'));
    // A second provisioning call here would be a divergent path of exactly
    // the kind that produced the duplicate-pool-factory outage.
    expect(login).not.toContain('/api/auth/workspace');
  });
});
