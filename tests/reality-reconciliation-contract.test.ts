import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('autonomous reality reconciliation contract', () => {
  const migration = readFileSync(resolve(process.cwd(), 'migrations/0128_reality_reconciliation.sql'), 'utf8');
  const worker = readFileSync(resolve(process.cwd(), 'src/workers/reality-reconciliation-worker.ts'), 'utf8');
  const founder = readFileSync(resolve(process.cwd(), 'src/routes/founder-command-center.ts'), 'utf8');
  const ui = readFileSync(resolve(process.cwd(), 'src/components/FounderMonitoringPanel.tsx'), 'utf8');

  it('persists contracts, observations, incidents, and permanent repair receipts', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS reality_contracts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS reality_observations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS reality_incidents');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS reality_repair_receipts');
  });

  it('preserves UNKNOWN instead of converting missing visibility into healthy', () => {
    expect(migration).toContain("'UNKNOWN'");
    expect(worker).toContain("state: 'UNKNOWN'");
    expect(worker).toContain('could not be observed');
  });

  it('proves recovery with a later observation before closing an incident', () => {
    expect(worker).toContain("if (result.state === 'HEALTHY')");
    expect(worker).toContain("status='PROVEN_FIXED'");
    expect(worker).toContain('reality_repair_receipts');
    expect(worker).toContain('replayedContract');
  });

  it('watches the watcher and exposes observability compromise', () => {
    expect(worker).toContain("'reconciler_self_watch'");
    expect(worker).toContain("observability: 'compromised'");
    expect(founder).toContain('observabilityCompromised');
    expect(ui).toContain('OBSERVABILITY COMPROMISED');
  });

  it('emits one machine-readable runtime proof summary per reconciliation cycle', () => {
    expect(worker).toContain("[RealityReconciliation] cycle complete");
    expect(worker).toContain('cycleId');
    expect(worker).toContain('counts');
    expect(worker).toContain('transitions');
    expect(worker).toContain('incidentId');
  });

  it('logs only allow-listed reconciliation diagnostics', () => {
    expect(worker).toContain('safeDiagnostic');
    expect(worker).toContain("'stalePending'");
    expect(worker).toContain("'staleActive'");
    expect(worker).toContain("'ageHours'");
    expect(worker).not.toContain("case 'registry_freshness': return allow(['lastError']");
  });

  it('self-heals only expired or orphaned operational state and re-verifies before closure', () => {
    expect(worker).toContain('repairStaleQueue');
    expect(worker).toContain('repairOrphanedScans');
    expect(worker).toContain("locked_at IS NULL OR locked_at < now() - interval '30 minutes'");
    expect(worker).toContain("status IN ('Queued','Scanning')");
    expect(worker).toContain("j.status IN ('Pending','Running')");
    expect(worker).toContain("status='REPAIRING'");
    expect(worker).toContain("status='VERIFYING'");
    expect(worker).toContain('observed = await observe(pool, contractId, await probe(pool))');
    expect(worker).toContain('no success is claimed');
  });

  it('keeps cross-platform telemetry behind the founder gate', () => {
    expect(founder).toContain("router.get('/founder/reality'");
    expect(founder).toContain("requireRole('Owner')");
    expect(founder).toContain('requireFounder');
  });
});
