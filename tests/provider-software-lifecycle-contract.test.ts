/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('provider software lifecycle contract', () => {
  const lifecycle = fs.readFileSync('migrations/0122_provider_software_observation_lifecycle.sql','utf8');
  const upsert = fs.readFileSync('migrations/0123_provider_software_last_seen_upsert.sql','utf8');
  const route = fs.readFileSync('src/routes/integrations-live.ts','utf8');

  it('refuses absence reconciliation unless the run is COMPLETE', () => {
    expect(lifecycle).toContain("status = 'COMPLETE'");
    expect(lifecycle).toContain('SOFTWARE_LIFECYCLE_REQUIRES_COMPLETE_RUN');
  });
  it('tracks unchanged observations as seen again instead of requiring duplicate rows', () => {
    expect(upsert).toContain('last_seen_run_id = EXCLUDED.collection_run_id');
    expect(upsert).toContain("lifecycle_status = 'ACTIVE'");
  });
  it('never reconciles absence for partial or unsupported collections', () => {
    expect(route).toContain("if (inventory.status === 'COMPLETE')");
    expect(route).toContain('reconcile_provider_software_inventory_lifecycle');
  });
});
