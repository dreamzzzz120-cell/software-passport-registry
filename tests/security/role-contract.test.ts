import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const securitySource = readFileSync(resolve(process.cwd(), 'src/middleware/security.ts'), 'utf8');
const integrationsSource = readFileSync(resolve(process.cwd(), 'src/routes/integrations-live.ts'), 'utf8');

describe('authentication role boundary contract', () => {
  it('uses an explicit finite role allowlist matching deployed RBAC roles', () => {
    expect(securitySource).toContain("const VALID_ROLES = new Set(['Owner', 'Admin', 'Operator', 'Technician', 'Viewer', 'Client']);");
    expect(securitySource).toContain('!VALID_ROLES.has(dbUser.role)');
  });

  it('fails closed for malformed Client principals', () => {
    expect(securitySource).toContain("dbUser.role === 'Client' && (!dbUser.clientId || dbUser.clientId.length > 256)");
  });

  it('does not treat a database role string as authorization by itself', () => {
    expect(securitySource).toContain('allowedRoles.includes(req.user.role)');
  });

  it('scopes provider customer enumeration to the authenticated Client', () => {
    expect(integrationsSource).toContain("const isClient = req.user!.role === 'Client';");
    expect(integrationsSource).toContain('const clientId = req.user!.clientId;');
    expect(integrationsSource).toContain('pc.client_id = ${clientId}');
    expect(integrationsSource).toContain('AND (${isClient ? sql`pc.client_id = ${clientId}` : sql`TRUE`})');
  });
});
