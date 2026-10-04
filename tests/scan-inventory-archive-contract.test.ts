import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('scan inventory archival contract', () => {
  it('archives the normalized per-file inventory before retention can delete database rows', async () => {
    const source = await readFile(new URL('../src/workers/security-scanner-worker.ts', import.meta.url), 'utf8');
    expect(source).toContain("artifactType: 'scan-file-inventory'");
    expect(source).toContain("contentType: 'application/gzip'");
    expect(source).toContain("schemaVersion: 'spr.scan-inventory.v1'");
    expect(source).toContain("name,type,verified,status,signer");
    expect(source).toContain("'Scan file inventory archive','Artifact Reference'");
    expect(source.indexOf("artifactType: 'scan-file-inventory'")).toBeLessThan(source.indexOf("event: 'scan_coverage_computed'"));
  });

  it('keeps retention limited to derived file rows rather than durable evidence', async () => {
    const source = await readFile(new URL('../src/workers/retention-worker.ts', import.meta.url), 'utf8');
    expect(source).toContain('DELETE FROM scan_file_inventory');
    expect(source).not.toMatch(/DELETE FROM evidence_items/i);
    expect(source).not.toMatch(/DELETE FROM scan_coverage/i);
    expect(source).not.toMatch(/DELETE FROM scan_findings/i);
    expect(source).not.toMatch(/DELETE FROM passports/i);
  });
});
