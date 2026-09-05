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
    expect(server).toContain("frameguard: { action: 'deny' }");
    expect(server).toContain("referrerPolicy: { policy: 'no-referrer' }");
  });
  it('uses an explicit normalized CORS allowlist and never implicitly trusts a Railway/Cloud Run hostname', () => {
    const server = read('server.ts'); const config = read('src/config.ts');
    expect(server).toContain('normalizeAllowedOrigins'); expect(config).toContain('parseOriginList');
    expect(server).not.toMatch(/includes\([^\n]*(railway|run\.app)[^\n]*\)/i);
  });
  it('mounts the Connect API once under the shared /api rate-limit boundary and keeps compatibility aliases', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api', connectRouter)"); expect(server).toContain("app.use('/api/connect', connectRouter)");
    expect(server).toContain("app.use('/api/integrations/connect', connectRouter)"); expect(server.match(/createConnectRouter\(\)/g)?.length).toBe(1);
  });
  it('keeps AI provenance derivative and evidence-referenced rather than treating AI output as evidence', () => {
    const ai = read('src/security/ai-provenance.ts'); expect(ai).toContain('evidenceIds'); expect(ai).not.toContain('evidence: true');
  });
  it('enforces tenant boundaries in database migrations', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql'); expect(sql).toContain('tenant_id'); expect(sql).toContain('spr_enforce_tenant_resource_integrity'); expect(sql).toContain('RAISE EXCEPTION');
  });
  it('contains connection-time SSRF defenses and refuses redirects', () => {
    const adapters = read('src/integrations/adapters.ts'); expect(adapters).toContain('blockPrivateAddress'); expect(adapters).toContain("redirect: 'error'"); expect(adapters).toContain('PROVIDER_URL_RESOLVES_PRIVATE');
  });
  it('contains webhook signing and an explicit replay window', () => {
    const webhook = read('src/security/webhook-signing.ts'); expect(webhook).toContain('WEBHOOK_REPLAY_WINDOW_SECONDS'); expect(webhook).toContain('timingSafeEqual'); expect(webhook).toContain('verifyWebhookSignature');
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
    // 0059+ are retained because 0059 is a production schema_migrations
    // compatibility marker; historical 0046-0058 files are not recreated with
    // fake no-op migrations, which could falsely imply missing schema changes.
    expect(versions).toContain(59);
    expect(versions[versions.length - 1]).toBeGreaterThanOrEqual(63);
  });
  it('keeps tenant-scoped deletion/integrity controls in the database layer', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql'); expect(sql).toContain('tenant_id'); expect(sql).toContain('BEFORE INSERT OR UPDATE'); expect(sql).toContain('monitoring_configurations'); expect(sql).toContain('collector_jobs');
  });
  it('keeps high-severity dependency auditing in the security gate', () => {
    const workflow = read('.github/workflows/security-gate.yml');
    expect(workflow).toContain('node scripts/audit-with-retry.mjs --audit-level=high');
    expect(workflow).not.toMatch(/audit[^\n]*\|\|\s*true/);
    const wrapper = read('scripts/audit-with-retry.mjs');
    expect(wrapper).toMatch(/const auditArgs = \['audit', '--json',[^\]]*\.\.\.passthrough\];/);
    expect(wrapper).not.toMatch(/\|\|\s*true/);
    expect(wrapper).toContain('TOTAL_BUDGET_MS');
    expect(wrapper).toContain('PER_ATTEMPT_TIMEOUT_MS');
  });

  it('pins every GitHub Action to a commit, never to a movable tag', () => {
    const workflows = fs.readdirSync(path.join(root, '.github', 'workflows')).filter(name => name.endsWith('.yml') || name.endsWith('.yaml'));
    for (const workflow of workflows) {
      const source = read(path.join('.github', 'workflows', workflow));
      for (const match of source.matchAll(/uses:\s*([^\s#]+)/g)) {
        expect(match[1], `${workflow}: ${match[1]}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
