import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const migrationVersions = () => fs.readdirSync(path.join(root, 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .map((name) => Number(name.slice(0, 4)))
  .sort((a, b) => a - b);

describe('SPR security release contracts', () => {
  it('has an enabled restrictive CSP and browser security headers', () => {
    const source = read('server.ts');
    expect(source).toContain('helmet({');
    expect(source).toContain('contentSecurityPolicy:');
    expect(source).toContain('defaultSrc');
    expect(source).toContain('objectSrc');
    expect(source).toContain('frameAncestors');
    expect(source).toContain('referrerPolicy');
    expect(source).toContain("frameguard: { action: 'deny' }");
  });

  it('uses an explicit normalized CORS allowlist and never implicitly trusts a platform hostname', () => {
    const source = read('server.ts');
    expect(source).toContain('normalizeAllowedOrigins');
    expect(source).toContain('normalizedOrigin');
    expect(source).toMatch(/allowedOrigins|VERCEL_TEAM_PREVIEW_ORIGIN/);
    expect(source).not.toMatch(/railway|run\.app/i);
  });

  it('mounts the Connect API under the shared /api boundary and keeps compatibility aliases', () => {
    const source = read('server.ts');
    expect(source).toContain("app.use('/api', rateLimiter)");
    expect(source).toContain("app.use('/api', connectRouter)");
    expect(source).toContain("app.use('/api/connect', connectRouter)");
    expect(source).toContain("app.use('/api/integrations/connect', connectRouter)");
  });

  it('keeps AI output derivative and evidence/provenance referenced rather than treating AI output as evidence', () => {
    const source = read('src/security/ai-provenance.ts');
    expect(source).toMatch(/evidenceIds/);
    expect(source).toMatch(/provenance|generatedAt|modelVersion|promptVersion/);
  });

  it('enforces tenant boundaries in database migrations', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql');
    expect(sql).toContain('tenant_id');
  });

  it('contains connection-time SSRF defenses for external HTTPS URLs', () => {
    const source = read('src/security/hardening.ts');
    expect(source).toContain('validateExternalHttpsUrl');
    expect(source).toContain('isPrivateIp');
    expect(source).toContain("url.protocol !== 'https:'");
    expect(source).toContain('Credential-bearing URLs are not permitted');
  });

  it('contains webhook signing and an explicit replay window', () => {
    const source = read('src/security/webhook-signing.ts');
    expect(source).toContain('WEBHOOK_REPLAY_WINDOW_SECONDS');
    expect(source).toContain('verifyWebhookSignature');
    expect(source).toContain('300');
  });

  it('enforces immutable, version-linked trust observations in SQL', () => {
    const sql = read('migrations/0001_immutable_trust_observations.sql');
    expect(sql).toContain('trust_observations');
    expect(sql).toContain('observation_version');
    expect(sql).toContain('prevent_trust_observation_mutation');
    expect(sql).toContain('TRUST_OBSERVATION_IMMUTABLE');
  });

  it('uses advisory locking and idempotent migration recording', () => {
    const migrate = read('scripts/migrate.ts');
    expect(migrate).toContain('pg_advisory_lock');
    expect(migrate).toContain('ON CONFLICT (version) DO NOTHING');
  });

  it('keeps migration versions unique and explicitly accounts for legacy numbering', () => {
    const versions = migrationVersions();
    expect(versions[0]).toBe(0);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toContain(44);
    expect(versions).toContain(45);
    expect(versions).toContain(59);
    expect(versions).toContain(60);
    expect(versions).toContain(62);
    expect(versions[versions.length - 1]).toBeGreaterThanOrEqual(62);
  });

  it('meters MSP usage by active monitored passports and protects the limit at the DB boundary', () => {
    const route = read('src/routes/msp.ts');
    const migration = read('migrations/0062_active_passport_entitlement_guard.sql');
    expect(route).toContain("billingUnit: 'active_passport'");
    expect(route).toContain('COUNT(DISTINCT passport_id)');
    expect(route).toContain("enabled=true");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('spr_enforce_active_passport_limit');
    expect(migration).toContain('ACTIVE_PASSPORT_LIMIT_REACHED');
  });

  it('keeps tenant-scoped deletion/integrity controls in the database layer', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql');
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('BEFORE INSERT OR UPDATE');
    expect(sql).toContain('monitoring_configurations');
    expect(sql).toContain('collector_jobs');
  });

  it('keeps high-severity dependency auditing in the security gate', () => {
    const workflow = read('.github/workflows/security-gate.yml');
    expect(workflow).toContain('node scripts/audit-with-retry.mjs --audit-level=high');
    expect(workflow).not.toMatch(/audit[^\n]*\|\|\s*true/);
  });

  it('pins every GitHub Action to a commit, never to a movable tag', () => {
    const workflows = fs.readdirSync(path.join(root, '.github/workflows'))
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .map((name) => read(path.join('.github/workflows', name)))
      .join('\n');
    expect(workflows).not.toMatch(/uses:\s*[^\s@]+@(?![0-9a-f]{40}\b)/i);
  });
});
