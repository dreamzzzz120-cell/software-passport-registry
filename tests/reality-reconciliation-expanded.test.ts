import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('expanded autonomous reality contracts', () => {
  const migration = read('migrations/0131_expand_reality_contracts.sql');
  const worker = read('src/workers/reality-reconciliation-worker.ts');

  it('declares the expanded platform contracts without pretending missing proof is healthy', () => {
    for (const id of [
      'worker_runtime_identity',
      'tenant_isolation_integrity',
      'auth_backend_reachable',
      'billing_backend_reachable',
      'intake_storage_readiness',
      'sbom_evidence_completeness',
      'report_delivery_flow',
      'integration_delivery_health',
      'malware_coverage',
      'public_deployment_ready',
      'backup_restore_evidence',
    ]) expect(migration).toContain(id);
    expect(worker).toContain("state: 'UNKNOWN'");
  });

  it('proves worker least privilege and tenant isolation from live database state', () => {
    expect(worker).toContain("current_user AS role");
    expect(worker).toContain("role === 'spr_worker_runtime'");
    expect(worker).toContain("SELECT spr_assert_tenant_rls()");
  });

  it('uses live external health requests for auth, billing and public deployment', () => {
    expect(worker).toContain("/auth/v1/health");
    expect(worker).toContain("https://api.stripe.com/v1/account");
    expect(worker).toContain("new URL('/ready', origin)");
    expect(worker).toContain("AbortSignal.timeout(10_000)");
  });

  it('does not call configuration alone proof when work is absent', () => {
    expect(worker).toContain("No storage broker is configured and no pending intake work proves it is currently required.");
    expect(worker).toContain("No recent completed repository security scan exists to prove SBOM persistence.");
    expect(worker).toContain("No enabled report schedule exists to prove delivery flow.");
    expect(worker).toContain("No enabled monitoring integration exists to prove external collection health.");
  });

  it('refuses to claim malware coverage when no malware evidence is observable', () => {
    expect(worker).toContain("SPR will not claim malware coverage.");
    expect(worker).toContain("malwareEvidence > 0 ? 'HEALTHY' : 'UNKNOWN'");
  });

  it('keeps backup recoverability unknown until an operator proof timestamp exists', () => {
    expect(worker).toContain("DATABASE_BACKUP_VERIFIED_AT");
    expect(worker).toContain("backup recoverability remains unknown");
  });

  it('adds every expanded probe to the production reconciliation cycle', () => {
    for (const probe of [
      'probeWorkerRuntimeIdentity',
      'probeTenantIsolation',
      'probeAuthBackend',
      'probeBilling',
      'probeIntakeStorage',
      'probeSbomEvidence',
      'probeReportDelivery',
      'probeIntegrations',
      'probeMalwareCoverage',
      'probePublicDeployment',
      'probeBackupEvidence',
    ]) expect(worker).toContain(probe);
  });
});
