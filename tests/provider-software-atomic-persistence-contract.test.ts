/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('provider software atomic persistence contract', () => {
  const migration = fs.readFileSync('migrations/0121_atomic_provider_software_persistence.sql', 'utf8');
  const route = fs.readFileSync('src/routes/integrations-live.ts', 'utf8');

  it('locks a RUNNING tenant-scoped run before finalization', () => {
    expect(migration).toContain("tenant_id = p_tenant_id AND status = 'RUNNING'");
    expect(migration).toContain('FOR UPDATE');
  });

  it('persists observations and terminalizes the run inside one database function', () => {
    expect(migration).toContain('INSERT INTO provider_software_observations');
    expect(migration).toContain('UPDATE provider_software_inventory_runs');
    expect(route).toContain('finalize_provider_software_inventory_run');
  });

  it('does not independently mark a successful collection COMPLETE in the route', () => {
    const softwareRoute = route.slice(route.indexOf("router.post('/:provider/customers/:externalId/software/discover'"), route.indexOf("router.get('/:provider/customers'"));
    expect(softwareRoute).not.toContain("SET status = ${inventory.status}");
    expect(softwareRoute).toContain("SET status = 'FAILED'");
  });

  it('keeps passport association null during evidence ingestion', () => {
    expect(migration).toMatch(/normalization_confidence, passport_id, source_observed_at/);
    expect(migration).toMatch(/\(item->>'normalizationConfidence'\)::numeric, NULL,/);
  });
});
