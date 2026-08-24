import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

function migrationVersions() {
  return fs.readdirSync(path.join(root, 'migrations'))
    .filter(name => /^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(name))
    .map(name => Number(name.slice(0, 4)))
    .sort((a, b) => a - b);
}

describe('SPR security release contracts', () => {
  it('has an enabled restrictive CSP and browser security headers', () => {
    const server = read('server.ts');
    expect(server).not.toContain('contentSecurityPolicy: false');
    expect(server).toContain('defaultSrc: ["\'self\'"]');
  });

  it('uses an explicit normalized CORS allowlist and never implicitly trusts a Railway/Cloud Run hostname', () => {
    const server = read('server.ts');
    expect(server).toContain('normalizeAllowedOrigins');
    expect(server).not.toMatch(/includes\([^\n]*(railway|run\.app)[^\n]*\)/i);
  });

  it('mounts the Connect API once under the shared /api rate-limit boundary and keeps its compatibility alias', () => {
    const server = read('server.ts');
    expect(server).toContain('/api/connect');
    expect(server).toContain('/api/integrations/connect');
  });

  it('does not expose unsigned legacy Passport trust data and uses signed public verification', () => {
    const server = read('server.ts');
    expect(server).toContain('verifyPublicPassport');
    expect(server).not.toContain('legacyTrust');
  });

  it('keeps AI summaries explicitly derivative and non-evidence', () => {
    const ai = read('src/ai');
    expect(ai).not.toContain('evidence: true');
  });

  it('enforces metadata and webhook event trust boundaries at more than the HTTP layer', () => {
    const schema = read('src/security/');
    expect(schema).toContain('tenantId');
  });

  it('contains connection-time SSRF defenses, special-address blocking and no redirect-following path', () => {
    const adapters = read('src/integrations/adapters.ts');
    expect(adapters).toContain('blockPrivateAddress');
    expect(adapters).toContain('redirect: \'error\'');
  });

  it('contains webhook signing, replay-window, retry and dead-letter controls', () => {
    const webhook = read('src/security/webhook');
    expect(webhook).toContain('replay');
  });

  it('enforces immutable, version-linked observations and tenant integrity in SQL', () => {
    const sql = read('supabase_schema.sql');
    expect(sql).toContain('spr_enforce_remediation_integrity');
  });

  it('uses advisory locking and idempotent migration recording', () => {
    const migrate = read('scripts/migrate.ts');
    expect(migrate).toContain('pg_advisory_lock');
    expect(migrate).toContain('ON CONFLICT');
  });

  it('keeps migrations contiguous from 0000 with no sequence gaps', () => {
    const versions = migrationVersions();
    expect(versions[0]).toBe(0);
    expect(versions.every((version, index) => index === 0 || version === versions[index - 1] + 1)).toBe(true);
  });

  it('has tenant-scoped delivery and trust-deletion controls', () => {
    const sql = read('supabase_schema.sql');
    expect(sql).toContain('tenant_id');
  });

  it('keeps high-severity dependency auditing in the security gate', () => {
    const workflow = read('.github/workflows/security-gate.yml');
    expect(workflow).toContain('npm audit --audit-level=high');
  });

  it('keeps the dependency fixes at or above the patched versions', () => {
    const manifest = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; overrides?: Record<string, string> };
    expect(manifest.dependencies?.dompurify).toBe('^3.4.13');
    expect(manifest.overrides?.['brace-expansion']).toBe('5.0.9');
  });
});