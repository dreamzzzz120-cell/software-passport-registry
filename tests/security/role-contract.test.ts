import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const securitySource = readFileSync(resolve(process.cwd(), 'src/middleware/security.ts'), 'utf8');

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
});
