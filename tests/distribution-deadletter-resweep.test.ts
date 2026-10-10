import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('distribution unsent sweep fail-closed retry guard', () => {
  const source = readFileSync(new URL('../src/workers/distribution-worker.ts', import.meta.url), 'utf8');
  const sql = source.match(/export const UNSENT_CONTACT_SQL = `([^`]+)`;/)?.[1];

  it('never automatically requeues a dead-lettered outreach contact', () => {
    expect(sql).toBeDefined();
    expect(sql).toContain("j.status IN ('queued','running','dead_letter')");
  });

  it('still blocks contacts with a sent email or a reserved provider attempt', () => {
    expect(sql).toContain("m.status='sent'");
    expect(sql).toContain("a.status IN ('reserved','unknown','blocked','sent')");
  });
});
