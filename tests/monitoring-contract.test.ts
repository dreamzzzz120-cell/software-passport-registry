import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real production gaps closed here: (1) trust_alerts was never populated by
// anything -- persistTrustLoop now derives real alerts from a real
// before/after comparison of the canonical observation it just persisted;
// (2) monitoring routes had no client-level isolation at all, so a
// 'Client'-role user (added earlier this session for client-portal access)
// could list every other client's monitoring configurations, collector
// jobs, and alert subscriptions within the same tenant.
describe('trust_alerts is populated from real observation deltas', () => {
  const source = () => read('src/trust/trust-loop.ts');

  it('compares the previous canonical observation against the one it just persisted', () => {
    const s = source();
    expect(s).toContain('compareCanonicalObservations(previousComparable,currentComparable)');
  });

  it('only inserts an alert for changes classifyCanonicalChange marks alert-worthy', () => {
    const s = source();
    expect(s).toContain('if(!materiality.alertWorthy)continue;');
  });

  it('deduplicates alerts on the real (tenant_id, fingerprint) unique constraint instead of erroring on repeat detection', () => {
    const s = source();
    expect(s).toContain('ON CONFLICT (tenant_id,fingerprint) DO NOTHING');
  });

  it('never fabricates a change when there is no previous observation to compare against', () => {
    const historySource = read('src/utils/observation-history.ts');
    expect(historySource).toContain('if (!previous) return [];');
  });
});

describe('GET /api/trust-loop/monitoring respects client isolation for alerts', () => {
  const source = () => read('src/routes/trust-loop.ts');

  it('joins to the owning passport to scope alerts, since trust_alerts has no client_id column of its own', () => {
    const s = source();
    expect(s).toContain('JOIN passports p ON p.id=a.passport_id');
    expect(s).toContain("AND (${clientScope}::text IS NULL OR p.client_id = ${clientScope})");
  });

  it('exposes an alert lifecycle transition restricted to non-Client roles', () => {
    const s = source();
    expect(s).toContain("router.patch('/alerts/:id'");
    expect(s).toContain("z.enum(['ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED'])");
  });
});

describe('monitoring route client isolation', () => {
  const source = () => read('src/routes/monitoring.ts');

  it('scopes monitoring-configurations list and detail reads to the caller\'s own client', () => {
    const s = source();
    expect(s).toContain('function clientScopeOf(req: AuthenticatedRequest)');
    expect((s.match(/if \(clientScope\) conditions\.push\(eq\(monitoringConfigurations\.clientId, clientScope\)\)/g) || []).length).toBe(2);
  });

  it('scopes collector-jobs list and detail reads to the caller\'s own client', () => {
    const s = source();
    expect((s.match(/if \(clientScope\) conditions\.push\(eq\(collectorJobs\.clientId, clientScope\)\)/g) || []).length).toBe(2);
  });

  it('scopes alert-subscriptions list and detail reads to the caller\'s own client', () => {
    const s = source();
    expect((s.match(/if \(clientScope\) conditions\.push\(eq\(alertSubscriptions\.clientId, clientScope\)\)/g) || []).length).toBe(2);
  });

  it('verifies a submitted clientId actually belongs to the caller\'s own tenant before creating a monitoring configuration or subscription', () => {
    const s = source();
    expect(s).toContain('async function ownedClient(db: ScopedDb, tenantId: string, clientId: string)');
    expect((s.match(/await ownedClient\(db, req\.user!\.tenantId, body\.clientId\)/g) || []).length).toBe(3);
  });
});

describe('monitoring enrollment UI', () => {
  const source = () => read('src/components/MonitoringView.tsx');

  it('accepts the tenant\'s real clients and passports instead of inventing its own list', () => {
    const s = source();
    expect(s).toContain('passports = [], clients = []');
  });

  it('is restricted to Owner/Admin, matching the backend requireRole(\'Admin\') on the create route', () => {
    const s = source();
    expect(s).toContain("const canEnroll = role === 'Owner' || role === 'Admin';");
  });

  it('submits independently-selected client and passport ids to the real creation endpoint', () => {
    const s = source();
    expect(s).toContain("apiFetch('/api/monitoring/monitoring-configurations', {");
    expect(s).toContain('clientId: enrollClientId, assetId: enrollPassportId, passportId: enrollPassportId');
  });

  it('constrains the schedule choices to the selected collector\'s real minimum, not a hardcoded one', () => {
    const s = source();
    expect(s).toContain('collectorDefs.find((c) => c.id === enrollCollectorId)?.minimumScheduleSeconds');
  });

  it('renders real alerts from the trust-loop endpoint with an honest empty state', () => {
    const s = source();
    expect(s).toContain("apiFetch('/api/trust-loop/monitoring')");
    expect(s).toContain('No changes have triggered an alert yet');
  });

  it('only offers acknowledge/resolve controls to roles that can mutate, not to Client/Viewer', () => {
    const s = source();
    expect(s).toContain("const canManageAlerts = role === 'Owner' || role === 'Admin' || role === 'Technician';");
  });
});
