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
    expect(server).toContain('defaultSrc:');
    expect(server).toContain("defaultSrc: [\"'self'\"]");
    expect(server).toContain("objectSrc: [\"'none'\"]");
    expect(server).toContain("frameAncestors: [\"'none'\"]");
    expect(server).toContain("formAction: [\"'self'\"]");
    expect(server).toContain('upgradeInsecureRequests: []');
  });

  it('does not expose legacy passport scores as authoritative public trust', () => {
    const route = read('src/routes/public-connect.ts');
    expect(route).not.toContain('SELECT id, name, version, overall_score');
    expect(route).not.toContain('score: row.overall_score');
    expect(route).toContain("scoreStatus: 'not_authoritatively_scored'");
  });

  it('keeps AI summaries explicitly derivative and non-evidence', () => {
    const route = read('src/routes/connect.ts');
    expect(route).toContain("type: 'ai_generated_derivative'");
    expect(route).toContain('isEvidence: false');
    expect(read('src/security/ai-provenance.ts')).toContain('evidenceIds');
  });

  it('enforces metadata and webhook event trust boundaries at more than the HTTP layer', () => {
    const connect = read('src/routes/connect.ts');
    const worker = read('src/workers/webhook-worker.ts');
    const migration = read('migrations/0009_authoritative_integrity_and_event_guards.sql');
    expect(connect).toContain('assertUntrustedMetadata');
    expect(worker).toContain('ALLOWED_WEBHOOK_EVENTS');
    expect(worker).toContain('if (!ALLOWED_WEBHOOK_EVENTS.has(input.eventType))');
    expect(migration).toContain('Unsupported webhook event type');
  });

  it('contains connection-time SSRF defenses and no redirect-following path', () => {
    const worker = read('src/workers/webhook-worker.ts');
    const validator = read('src/security/webhook-url.ts');
    expect(worker).toContain('dns.lookup(hostname, { all: true, verbatim: true })');
    expect(worker).toContain('lookup: (_hostname, _options, callback) => callback(null, ip');
    expect(worker).toContain('maxRedirects: 0');
    expect(validator).toContain('records.some(record => isBlockedAddress(record.address))');
    expect(validator).toContain("url.protocol !== 'https:'");
  });

  it('contains webhook signing, replay-window, retry and dead-letter controls', () => {
    const signing = read('src/security/webhook-signing.ts');
    const worker = read('src/workers/webhook-worker.ts');
    expect(signing).toContain('MAX_CLOCK_SKEW_SECONDS = 300');
    expect(signing).toContain('timingSafeEqual');
    expect(worker).toContain('MAX_ATTEMPTS = 6');
    expect(worker).toContain("'dead_lettered'");
    expect(worker).toContain('backoffSeconds');
    expect(worker).toContain('x-spr-signature');
  });

  it('enforces immutable, version-linked observations and tenant integrity in SQL', () => {
    const immutable = read('migrations/0001_immutable_trust_observations.sql');
    const authoritative = read('migrations/0009_authoritative_integrity_and_event_guards.sql');
    const foreignKeys = read('migrations/0010_foreign_key_integrity.sql');
    expect(immutable).toContain('BEFORE UPDATE OR DELETE ON trust_observations');
    expect(authoritative).toContain('Trust observation chain is invalid');
    expect(authoritative).toContain('trust_observations_tenant_passport_idempotency');
    expect(foreignKeys).toContain('trust_observations_previous_fk');
    expect(foreignKeys).toContain('spr_webhook_deliveries_webhook_fk');
  });

  it('uses advisory locking and idempotent migration recording', () => {
    const runner = read('scripts/migrate.ts');
    expect(runner).toContain('pg_advisory_lock');
    expect(runner).toContain('pg_advisory_unlock');
    expect(runner).toContain('ON CONFLICT (version) DO NOTHING');
    expect(runner).toContain('BEGIN');
    expect(runner).toContain('COMMIT');
  });

  it('keeps migrations contiguous from 0000 with no sequence gaps', () => {
    const versions = migrationVersions();
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toBe(0);
    versions.forEach((version, index) => expect(version).toBe(index));
  });

  it('has tenant-scoped delivery and trust-deletion controls', () => {
    const sync = read('src/db/sync.ts');
    const deliveryMigration = read('migrations/0009_authoritative_integrity_and_event_guards.sql');
    expect(sync).toContain('db.transaction');
    expect(sync).toContain('information_schema.columns');
    expect(sync).toContain('tenant_id');
    expect(deliveryMigration).toContain('Webhook delivery does not belong to webhook tenant');
    expect(deliveryMigration).toContain('spr_enforce_remediation_integrity');
  });
});
