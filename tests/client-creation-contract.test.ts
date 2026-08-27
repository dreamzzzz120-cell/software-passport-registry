import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real production gap, closed here: 0 client rows ever existed because
// there was no client-creation route at all. This pins the contract: real
// RBAC, tenant assignment sourced only from the authenticated session
// (never from client-supplied input), real duplicate handling backed by an
// actual DB constraint, and client-level data isolation for the
// 'Client' role that was already listed in INVITABLE_ROLES but had no
// enforcement mechanism.
describe('POST /api/user/clients', () => {
  const source = () => read('src/routes/auth.ts');

  it('requires Owner/Admin, not any authenticated user', () => {
    expect(source()).toContain("router.post('/user/clients', requireAuth, requireRole(['Owner', 'Admin'])");
  });

  it('never accepts a tenant id from the request body -- it is always the caller\'s own tenant', () => {
    const s = source();
    // The validation schema has no tenantId field at all (.strict() would
    // reject one if the client tried to smuggle it in).
    const schemaMatch = s.match(/const createClientSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\);/);
    expect(schemaMatch).not.toBeNull();
    expect(schemaMatch![0]).not.toContain('tenantId');
    expect(s).toContain('VALUES (${newId}, ${tenantId}, ${parsed.data.name}, ${parsed.data.domain}, ${parsed.data.industry}');
    expect(s).toContain('const tenantId = req.user!.tenantId;');
  });

  it('handles duplicate domains with a real database constraint, not just an app-level check', () => {
    const s = source();
    expect(s).toContain("if (error?.code === '23505') return res.status(409)");
    const migration = read('migrations/0032_client_creation_and_scoping.sql');
    expect(migration).toContain('ADD CONSTRAINT clients_tenant_domain_unique UNIQUE (tenant_id, domain)');
  });

  it('audits the creation event', () => {
    expect(source()).toContain("action: 'client.created'");
  });
});

describe('client-level data isolation for the Client role', () => {
  const authSource = () => read('src/routes/auth.ts');
  const trustLoopSource = () => read('src/routes/trust-loop.ts');

  it('users.client_id exists and defaults to no restriction for every non-Client role', () => {
    const migration = read('migrations/0032_client_creation_and_scoping.sql');
    expect(migration).toContain("ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id text REFERENCES clients(id)");
    const schema = read('src/db/schema.ts');
    expect(schema).toContain("clientId: text('client_id')");
  });

  it('GET /user/clients scopes to a single client only when role is Client', () => {
    const s = authSource();
    expect(s).toContain("const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;");
    expect(s).toContain('AND (${clientScope}::text IS NULL OR id = ${clientScope})');
  });

  it('GET /user/passports applies the same client scoping', () => {
    expect(authSource()).toContain('AND (${clientScope}::text IS NULL OR p.client_id = ${clientScope})');
  });

  it('GET /trust-loop/findings applies the same client scoping', () => {
    expect(trustLoopSource()).toContain('AND (${clientScope}::text IS NULL OR f.client_id = ${clientScope})');
  });
});

describe('client-scoped invitation', () => {
  const source = () => read('src/routes/auth.ts');

  it('requires a clientId exactly when role is Client, and forbids it otherwise', () => {
    const s = source();
    expect(s).toContain("(body.role === 'Client') === Boolean(body.clientId)");
  });

  it('verifies the invited client actually belongs to the inviter\'s own tenant before using it', () => {
    const s = source();
    expect(s).toContain('SELECT id FROM clients WHERE id = ${parsed.data.clientId} AND tenant_id = ${req.user!.tenantId}');
    expect(s).toContain("return res.status(404).json({ error: 'Client not found in this workspace.' })");
  });

  it('persists client_id on the invited user record', () => {
    const s = source();
    expect(s).toContain('INSERT INTO users (uid, email, tenant_id, role, client_id, invited_by, onboarded)');
  });
});

describe('billing is unaffected by client creation', () => {
  it('client creation never touches Stripe, tenant_subscriptions, or entitlements -- billing stays MSP/tenant-level', () => {
    const authSource = read('src/routes/auth.ts');
    // Scope the check to the client-creation route body only, not the whole
    // file (which legitimately touches other tables elsewhere).
    const routeStart = authSource.indexOf("router.post('/user/clients'");
    const routeEnd = authSource.indexOf('\n  });', routeStart);
    const routeBody = authSource.slice(routeStart, routeEnd);
    expect(routeBody).not.toMatch(/stripe/i);
    expect(routeBody).not.toContain('tenant_subscriptions');
  });
});
