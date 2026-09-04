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
  it('keeps migrations contiguous from 0000 with no sequence gaps', () => {
    const versions = migrationVersions(); expect(versions[0]).toBe(0); expect(versions.every((version, index) => index === 0 || version === versions[index - 1] + 1)).toBe(true);
  });
  it('keeps tenant-scoped deletion/integrity controls in the database layer', () => {
    const sql = read('migrations/0004_tenant_resource_integrity.sql'); expect(sql).toContain('tenant_id'); expect(sql).toContain('BEFORE INSERT OR UPDATE'); expect(sql).toContain('monitoring_configurations'); expect(sql).toContain('collector_jobs');
  });
  it('keeps high-severity dependency auditing in the security gate', () => {
    // The gate now runs the audit through scripts/audit-with-retry.mjs, which
    // retries an unreachable npm audit endpoint but never a finding. Assert the
    // whole chain rather than one literal: the gate asks for the high level, the
    // wrapper really invokes npm audit at the level it was asked for, and
    // neither end has been given a way to report success without a report.
    const workflow = read('.github/workflows/security-gate.yml');
    expect(workflow).toContain('node scripts/audit-with-retry.mjs --audit-level=high');
    expect(workflow).not.toMatch(/audit[^\n]*\|\|\s*true/);
    const wrapper = read('scripts/audit-with-retry.mjs');
    expect(wrapper).toMatch(/const auditArgs = \['audit', '--json',[^\]]*\.\.\.passthrough\];/);
    expect(wrapper).not.toMatch(/\|\|\s*true/);
    // The wrapper must own its clock. Without a budget of its own it ran past
    // timeout-minutes and both gates were reported CANCELLED rather than
    // failing, which states nothing at all.
    expect(wrapper).toContain('TOTAL_BUDGET_MS');
    expect(wrapper).toContain('PER_ATTEMPT_TIMEOUT_MS');
  });

  it('pins every GitHub Action to a commit, never to a movable tag', () => {
    // A tag is a pointer its owner can move. `gitleaks/gitleaks-action@v2` runs
    // third-party code inside the security gate with GITHUB_TOKEN and
    // security-events: write, and `@v2` retargeted upstream would execute there
    // with no change to this repository at all. A 40-hex commit cannot be
    // retargeted, so an upgrade becomes a reviewable diff instead of a silent
    // substitution.
    const dir = path.join(root, '.github/workflows');
    const unpinned: string[] = [];
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
      for (const [, ref] of read(`.github/workflows/${file}`).matchAll(/uses:\s*(\S+)/g)) {
        if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(`${file}: ${ref}`);
      }
    }
    expect(unpinned, `actions pinned to a movable ref: ${unpinned.join(', ')}`).toEqual([]);
  });

  it('never runs dependency install scripts in a workflow', () => {
    // `npm ci` runs every transitive package's postinstall. In CI that is
    // arbitrary code from the dependency tree executing on a runner with the
    // repository checked out, before any gate has judged the tree. The Dockerfile
    // has always installed with --ignore-scripts; the workflows now match it.
    const dir = path.join(root, '.github/workflows');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.yml'))) {
      for (const line of read(`.github/workflows/${file}`).split('\n')) {
        if (/\bnpm (ci|install)\b/.test(line) && !line.includes('--ignore-scripts') && !line.includes('--global')) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, `installs that would run package scripts: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('never pushes an automated dependency rewrite straight to main', () => {
    // `npm audit fix --force` may take major versions. The verify step catches a
    // tree that stops building or testing, not one that quietly changed
    // behaviour, so the result goes to a pull request for a human to look at.
    const workflow = read('.github/workflows/dependency-remediation.yml');
    expect(workflow).not.toMatch(/git push origin main/);
    expect(workflow).toContain('gh pr create');
    expect(workflow).toContain('--base main');
  });

  it('never lets a dependency audit step pass on a failure', () => {
    // continue-on-error on any audit step would turn every gate below into
    // decoration, and is the most likely way an outage gets "fixed" under time
    // pressure.
    for (const file of ['security-gate.yml', 'security-hardening.yml', 'hardening-gate.yml', 'dependency-remediation.yml']) {
      const workflow = read(`.github/workflows/${file}`);
      expect(workflow, `${file} must not skip audit failures`).not.toContain('continue-on-error: true');
      expect(workflow, `${file} must audit through the fail-closed wrapper`).toContain('node scripts/audit-with-retry.mjs');
    }
  });
  it('keeps dependency fixes at or above the patched versions', () => {
    const manifest = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; overrides?: Record<string, string> };
    // "at or above", not "exactly": pinning the equality is what made a routine
    // patch bump (dompurify 3.4.13 -> 3.4.14) fail the security gate for moving
    // FURTHER past the advisory, blocking five production deploys. Re-pinning
    // the equality to the new version only defers the same failure to 3.4.15.
    // A version BELOW the patched one must still fail, and does.
    const atLeast = (declared: string | undefined, patched: string) => {
      expect(declared).toBeDefined();
      const parts = (raw: string) => raw.replace(/^[^0-9]*/, '').split('.').map(Number);
      const [actual, minimum] = [parts(declared!), parts(patched)];
      expect(actual.every((n) => Number.isInteger(n))).toBe(true);
      expect(actual.length).toBe(minimum.length);
      for (let i = 0; i < minimum.length; i += 1) {
        if (actual[i] !== minimum[i]) return expect(actual[i]).toBeGreaterThan(minimum[i]);
      }
      return expect(actual).toEqual(minimum);
    };
    // The caret range must stay on the patched major, so the advisory fix
    // cannot be dropped by a range that also admits an older major.
    expect(manifest.dependencies?.dompurify?.startsWith('^3.')).toBe(true);
    atLeast(manifest.dependencies?.dompurify, '3.4.13');
    atLeast(manifest.overrides?.['brace-expansion'], '5.0.9');
  });
});
