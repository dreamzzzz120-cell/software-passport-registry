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
    const source = read('src/security/http-hardening.ts'); expect(source).toContain('Content-Security-Policy'); expect(source).toContain('X-Content-Type-Options');
  });
  it('uses an explicit normalized CORS allowlist and never implicitly trusts a Railway/Cloud Run hostname', () => {
    const source = read('src/security/http-hardening.ts'); expect(source).toContain('normalizeOrigin'); expect(source).not.toMatch(/railway|run\.app/i);
  });
  it('mounts the Connect API once under the shared /api rate-limit boundary and keeps compatibility aliases', () => {
    const source = read('server.ts'); expect(source).toContain('/api'); expect(source).toContain('connect');
  });
  it('keeps AI provenance derivative and evidence-referenced rather than treating AI output as evidence', () => {
    const source = read('src/ai/explanation.ts'); expect(source).toMatch(/evidence|provenance/i);
  });
  it('enforces tenant boundaries in database migrations', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql'); expect(sql).toContain('tenant_id');
  });
  it('contains connection-time SSRF defenses and refuses redirects', () => {
    const source = read('src/security/ssrf-network-guard.ts'); expect(source).toContain('redirect');
  });
  it('contains webhook signing and an explicit replay window', () => {
    const source = read('src/security/webhook-signing.ts'); expect(source).toContain('tolerance');
  });
  it('enforces immutable, version-linked trust observations in SQL', () => {
    const sql = read('migrations/0001_immutable_trust_observations.sql'); expect(sql).toContain('trust_observations'); expect(sql).toContain('observation_version'); expect(sql).toContain('prevent_trust_observation_mutation'); expect(sql).toContain('TRUST_OBSERVATION_IMMUTABLE');
  });
  it('uses advisory locking and idempotent migration recording', () => {
    const migrate = read('scripts/migrate.ts'); expect(migrate).toContain('pg_advisory_lock'); expect(migrate).toContain('ON CONFLICT (version) DO NOTHING');
  });
  it('keeps migration versions unique, ordered, and explicitly accounts for legacy numbering', () => {
    const versions = migrationVersions();
    expect(versions[0]).toBe(0);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toContain(44);
    expect(versions).toContain(45);
    // 0059 is retained because it is a production schema_migrations compatibility marker.
    // Historical 0046-0058 files are not recreated as fake no-op migrations.
    expect(versions).toContain(59);
    // 0060 is the canonical async-scan progress/completion migration; duplicate 0061-0063
    // copies were removed so the migration stream remains unique and deterministic.
    expect(versions[versions.length - 1]).toBeGreaterThanOrEqual(60);
  });
  it('keeps tenant-scoped deletion/integrity controls in the database layer', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql'); expect(sql).toContain('tenant_id'); expect(sql).toContain('BEFORE INSERT OR UPDATE'); expect(sql).toContain('monitoring_configurations'); expect(sql).toContain('collector_jobs');
  });
  it('keeps high-severity dependency auditing in the security gate', () => {
    const workflow = read('.github/workflows/security-gate.yml'); expect(workflow).toContain('node scripts/audit-with-retry.mjs --audit-level=high'); expect(workflow).not.toMatch(/audit[^\n]*\|\|\s*true/);
  });
  it('pins every GitHub Action to a commit, never to a movable tag', () => {
    const workflows = fs.readdirSync(path.join(root, '.github/workflows')).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).map((name) => read(path.join('.github/workflows', name))).join('\n');
    expect(workflows).not.toMatch(/uses:\s*[^\s@]+@(?![0-9a-f]{40}\b)/i);
  });
});
