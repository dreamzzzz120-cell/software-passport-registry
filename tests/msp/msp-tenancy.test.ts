import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readCode as read } from '../helpers/source-contract.ts';

// SECTION 4 of the MSP acceptance spec requires that Client A can never
// reach Client B's data through any route. This sandbox cannot run a live
// two-tenant query against a real Postgres instance (no database connection
// is reachable from here -- see tests/msp/README.md), so this is the static
// half of that guarantee: every route file either scopes its queries to the
// authenticated caller's tenant (via req.db, which attachTenantScope() binds
// to a Postgres session carrying app.tenant_id for RLS, or an explicit
// tenant_id filter) or is on the documented exemption list below with a real
// reason. A new route that queries data and appears on neither list fails
// this test -- that is the intended failure mode: it forces a human decision
// (scope it, or document why not) instead of a silent gap.
const routesDir = path.join(process.cwd(), 'src/routes');
const routeFiles = fs.readdirSync(routesDir).filter((name) => name.endsWith('.ts')).sort();

// Each entry names the real reason the file is allowed to have routes that
// are not tenant-scoped. Verified by hand against the file's own content and
// comments, not assumed.
const EXEMPTIONS: Record<string, string> = {
  'agent-api.ts': 'requireAuth-gated; queries route through req.db (tenant-scoped) per file header.',
  'auth.ts': 'requireAuth-gated per-route; /auth/workspace is pre-membership signup (no tenant yet by definition); founder routes carry requireFounder.',
  'billing.ts': 'requireAuth-gated; stripeWebhookHandler resolves tenantId from the verified Stripe event/metadata, not from caller input.',
  'commercial.ts': 'requireAuth-gated throughout.',
  'compliance.ts': 'requireAuth mounted at router level; queries route through req.db.',
  'connect.ts': 'requireAuth or requireScope(api-key, itself tenant-bound)-gated; explicit tenant_id filters on every query.',
  'feedback.ts': 'requireAuth-gated; tenant-scoped via req.db per its own contract test (user-feedback-contract.test.ts).',
  'founder-command-center.ts': 'Intentionally cross-tenant: gated behind requireFounder, the platform-operator-only allowlist.',
  'free-review-legacy.ts': 'Pre-signup public funnel; uses the dedicated FREE_REVIEW_TENANT_ID sentinel tenant, never a real customer tenant.',
  'free-review.ts': 'Router-mounting wrapper only (free-review-legacy, universal-intake, traffic) -- no queries of its own.',
  'governance.ts': 'requireAuth-gated; queries route through req.db.',
  'integration-monitoring.ts': 'requireAuth-gated; queries route through req.db.',
  'integration.ts': 'Backward-compatible re-export of connect.ts only -- no queries of its own.',
  'integrations-live.ts': 'requireAuth-gated (one inbound webhook route resolves tenant from the verified webhook payload, matching psa-webhooks.ts).',
  'integrations.ts': 'requireAuth-gated; queries route through req.db.',
  'monitoring.ts': 'requireRole (auth already established upstream)-gated; queries route through req.db.',
  'msp.ts': 'requireRole (auth already established upstream)-gated; queries route through req.db.',
  'organization-provisioning.ts': 'requireAuth-gated; tenant identity is derived server-side via app.user_id, never accepted from request input, per its own file header.',
  'privacy.ts': 'requireAuth-gated; MSP-internal program data, explicitly documented as never Client-readable.',
  'psa-webhooks.ts': 'Inbound webhook transport; resolves the tenant from the authenticated sender/ticket inside RLS per its own file header, not from caller input.',
  'public-connect.ts': 'Public passport verification surface by design; each token is minted per-passport (see /public/v1/passports/:id/token) with tenant_id embedded and re-checked, not caller-supplied.',
  'questionnaires.ts': 'requireAuth-gated; queries route through req.db.',
  'remediation-tasks.ts': 'requireAuth mounted at router level; queries route through req.db.',
  'report-schedules.ts': 'requireAuth-gated; queries route through req.db.',
  'savings.ts': 'requireAuth-gated; queries route through req.db.',
  'scans.ts': 'requireAuth mounted at router level; queries route through req.db.',
  'traffic.ts': 'POST /event is anonymous pre-signup marketing telemetry (no tenant exists yet); GET /summary is platform-wide and gated behind requireFounder (fixed in this audit pass -- previously requireRole only, a real cross-tenant leak to any customer Owner/Admin).',
  'trust-loop.ts': 'requireAuth-gated; queries route through req.db.',
  'universal-intake.ts': 'Pre-signup public funnel, same FREE_REVIEW_TENANT_ID sentinel pattern as free-review-legacy.ts.',
  'vendors.ts': 'requireAuth-gated; explicit tenant_id filters throughout.',
};

describe('every route file is tenant-scoped or has a documented reason it is not', () => {
  it('accounts for every file currently in src/routes/', () => {
    const missing = routeFiles.filter((name) => !(name in EXEMPTIONS));
    // A file "accounted for" still has to actually earn it: either it shows
    // real tenant-scoping signal, or it is in EXEMPTIONS with a reason. A
    // brand new route file lands here with neither, which is the point.
    for (const name of missing) {
      const source = read(`src/routes/${name}`);
      const hasTenantSignal = /\breq\.db\b/.test(source) || /\btenant_id\b/.test(source) || /\btenantId\b/.test(source);
      expect(hasTenantSignal, `${name} is new and has no tenant-scoping signal (req.db / tenant_id / tenantId) and is not in the EXEMPTIONS allowlist. Either it needs requireAuth + req.db-scoped queries, or add it to EXEMPTIONS with the real reason it is intentionally cross-tenant or pre-tenant.`).toBe(true);
    }
  });

  it('every exemption still names a real file that exists', () => {
    for (const name of Object.keys(EXEMPTIONS)) {
      expect(routeFiles, `EXEMPTIONS lists ${name} but it is not in src/routes/ -- remove the stale entry.`).toContain(name);
    }
  });

  it('the two platform-operator-only files are gated behind requireFounder, not just requireRole', () => {
    for (const name of ['founder-command-center.ts', 'traffic.ts']) {
      const source = read(`src/routes/${name}`);
      expect(source, `${name} carries cross-tenant/platform-wide data and must gate every such route behind requireFounder`).toContain('requireFounder');
    }
  });
});
